import asyncio
import websockets
import json
import motor.motor_asyncio
from datetime import datetime
import random
import time

# MongoDB setup
MONGO_URI = "mongodb://localhost:27017"
DB_NAME = "casino_war_db"
COLLECTION_NAME = "game_results"

client = motor.motor_asyncio.AsyncIOMotorClient(MONGO_URI)
db = client[DB_NAME] 
results_collection = db[COLLECTION_NAME]

connected_clients = set()
dealer_clients = set()
player_clients = {}  # {player_id: websocket}

# Card values for comparison (Ace is highest)
CARD_VALUES = {
    'A': 14, 'K': 13, 'Q': 12, 'J': 11, 'T': 10,
    '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2
}

# Global game state
game_state = {
    "deck": [],
    "burned_cards": [],
    "dealer_card": None,
    "players": {},  # {player_id: {card: None, status: 'active/war/surrender', result: None}}
    "round_active": False,
    "round_number": 0,
    "game_mode": "manual",  # manual, automatic, live
    "table_number": 1,
    "min_bet": 10,
    "max_bet": 1000,
    "player_results": {},  # {player_id: last_result} for display screen    
    "auto_task": None,  # For automatic mode task
    "auto_round_delay": 5,  # Seconds between automatic rounds
    "auto_choice_delay": 3,  # Seconds to wait for player choices before auto-surrender
}

def create_deck():
    """Creates 6 standard 52-card decks and shuffles them."""
    ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K"]
    suits = ["S", "D", "C", "H"]
    deck = []
    
    # Create 6 decks
    for _ in range(6):
        for rank in ranks:
            for suit in suits:
                deck.append(rank + suit)
    
    random.shuffle(deck)
    return deck

def get_card_value(card):
    """Returns the numerical value of a card for comparison."""
    if not card or len(card) < 2:
        return 0
    return CARD_VALUES.get(card[0], 0)

def compare_cards(player_card, dealer_card):
    """Compares two cards and returns result."""
    player_val = get_card_value(player_card)
    dealer_val = get_card_value(dealer_card)
    
    if player_val > dealer_val:
        return "win"
    elif player_val < dealer_val:
        return "lose"
    else:
        return "tie"

async def handle_connection(websocket, path=None):
    """Handles new client connections."""
    connected_clients.add(websocket)
    print(f"Client connected: {websocket.remote_address}")
    
    # Send current game state to new client
    await websocket.send(json.dumps({
        "action": "game_state_update",
        "game_state": {
            "deck_count": len(game_state["deck"]),
            "burned_cards_count": len(game_state["burned_cards"]),
            "dealer_card": game_state["dealer_card"],
            "players": game_state["players"],
            "round_active": game_state["round_active"],
            "round_number": game_state["round_number"],
            "game_mode": game_state["game_mode"],
            "table_number": game_state["table_number"],
            "min_bet": game_state["min_bet"],
            "max_bet": game_state["max_bet"],
            "player_results": game_state["player_results"]
        }
    }))

    try:
        async for message in websocket:
            data = json.loads(message)
            print(f"Received: {data}")
            
            # Route messages based on action
            if data["action"] == "register_dealer":
                dealer_clients.add(websocket)
                await websocket.send(json.dumps({"action": "dealer_registered"}))
                
            elif data["action"] == "register_player":
                player_id = data["player_id"]
                player_clients[player_id] = websocket
                await websocket.send(json.dumps({
                    "action": "player_registered", 
                    "player_id": player_id
                }))
                
            elif data["action"] == "shuffle_deck":
                await handle_shuffle_deck()
                
            elif data["action"] == "burn_card":
                await handle_burn_card()
                
            elif data["action"] == "add_player":
                await handle_add_player(data["player_id"])
                
            elif data["action"] == "remove_player":
                await handle_remove_player(data["player_id"])
                
            elif data["action"] == "deal_cards":
                await handle_deal_cards()
                
            elif data["action"] == "reset_game":
                await handle_reset_game()
                
            elif data["action"] == "change_bets":
                await handle_change_bets(data["min_bet"], data["max_bet"])
                
            elif data["action"] == "change_table":
                await handle_change_table(data["table_number"])
                
            elif data["action"] == "undo_last_card":
                await handle_undo_last_card()
                
            elif data["action"] == "add_card_manual":
                await handle_add_card_manual(data["card"])
                
            elif data["action"] == "player_choice":
                await handle_player_choice(data["player_id"], data["choice"])  # war or surrender
                
            elif data["action"] == "set_game_mode":
                await handle_set_game_mode(data["mode"])
                
            elif data["action"] == "live_card_scanned":
                await handle_live_card_scan(data["card"])
                
            elif data["action"] == "setup_live_mode":
                await handle_live_mode_setup()
            
            elif data["action"] == "assign_war_card":
                await handle_assign_war_card(data["target"], data["card"], data.get("player_id"))
            elif data["action"] == "evaluate_war_round":
                await evaluate_war_round()
                
            elif data["action"] == "manual_deal_card":
                await handle_manual_deal_card(data["target"], data["card"], data.get("player_id"))
#new handle connection for manual evalatuation
            elif data["action"] == "evaluate_round":
                # Check that every active (added) player has a card assigned.
                incomplete = [pid for pid, pdata in game_state["players"].items() if pdata.get("card") is None]
                if incomplete:
                    await broadcast_to_dealers({
                        "action": "error",
                        "message": f"Players {', '.join(incomplete)} have not been assigned a card."
                    })
                else:
                    await evaluate_round()
            elif data["action"] == "start_auto_round":
                await handle_start_auto_round()
            elif data["action"] == "clear_round":
                await handle_clear_round()
                
    except websockets.ConnectionClosed:
        print(f"Client disconnected: {websocket.remote_address}")
    finally:
        connected_clients.remove(websocket)
        if websocket in dealer_clients:
            dealer_clients.remove(websocket)
        # Remove from player clients if exists
        for player_id, client in list(player_clients.items()):
            if client == websocket:
                del player_clients[player_id]
                break

async def handle_shuffle_deck():
    """Shuffles the deck and burns the first card."""
    game_state["deck"] = create_deck()
    game_state["burned_cards"] = []
    
    # Auto-burn first card
    if game_state["deck"]:
        burned_card = game_state["deck"].pop(0)
        game_state["burned_cards"].append(burned_card)
    
    await broadcast_to_all({
        "action": "deck_shuffled",
        "deck_count": len(game_state["deck"]),
        "burned_card": burned_card if game_state["burned_cards"] else None,
        "burned_cards_count": len(game_state["burned_cards"])
    })

async def handle_burn_card():
    """Burns the top card from the deck."""
    if not game_state["deck"]:
        await broadcast_to_dealers({"action": "error", "message": "No cards left to burn"})
        return
    
    burned_card = game_state["deck"].pop(0)
    game_state["burned_cards"].append(burned_card)
    
    await broadcast_to_all({
        "action": "card_burned",
        "burned_card": burned_card,
        "deck_count": len(game_state["deck"]),
        "burned_cards_count": len(game_state["burned_cards"])
    })

async def handle_add_player(player_id):
    """Adds a new player to the game."""
    if len(game_state["players"]) >= 6:
        await broadcast_to_dealers({"action": "error", "message": "Maximum 6 players allowed"})
        return
    
    game_state["players"][player_id] = {
        "card": None,
        "status": "active",
        "result": None,
        "war_card": None
    }
    
    await broadcast_to_all({
        "action": "player_added",
        "player_id": player_id,
        "players": game_state["players"]
    })

async def handle_remove_player(player_id):
    """Removes a player from the game."""
    if player_id in game_state["players"]:
        del game_state["players"][player_id]
        
        if player_id in game_state["player_results"]:
            del game_state["player_results"][player_id]
    
    await broadcast_to_all({
        "action": "player_removed",
        "player_id": player_id,
        "players": game_state["players"],
        "player_results": game_state["player_results"]
    })

async def handle_deal_cards():
    """Deals one card to each player and dealer."""
    # Only allow manual dealing in manual mode
    if game_state["game_mode"] != "manual":
        await broadcast_to_dealers({
            "action": "error", 
            "message": f"Cannot manually deal cards in {game_state['game_mode']} mode"
        })
        return
    
    await deal_cards_internal()

async def deal_cards_internal():
    """Internal function to deal cards (used by all modes)."""
    if not game_state["deck"]:
        await broadcast_to_dealers({"action": "error", "message": "No cards left in deck"})
        return False
    
    if len(game_state["deck"]) < len(game_state["players"]) + 1:
        await broadcast_to_dealers({"action": "error", "message": "Not enough cards for all players and dealer"})
        return False
    
    game_state["round_number"] += 1
    game_state["round_active"] = True
    
    # Deal cards to players
    for player_id in game_state["players"]:
        if game_state["deck"]:
            card = game_state["deck"].pop(0)
            game_state["players"][player_id]["card"] = card
            game_state["players"][player_id]["status"] = "active"
            game_state["players"][player_id]["result"] = None
            game_state["players"][player_id]["war_card"] = None
            # Track the card assignment order
            game_state.setdefault("assignment_order", []).append({"player_id": player_id, "card": card, "type": "player"})
    # Deal card to dealer
    if game_state["deck"]:
        game_state["dealer_card"] = game_state["deck"].pop(0)
        # Track the card assignment order
        game_state["assignment_order"].append({"card": game_state["dealer_card"], "type": "dealer"})
    
    # Evaluate results
    await evaluate_round()
    return True

async def evaluate_round():
    """Evaluates the round results and handles ties."""
    tie_players = []
    for player_id, player_data in game_state["players"].items():
        player_card = player_data["card"]
        result = compare_cards(player_card, game_state["dealer_card"])
        if result == "tie":
            tie_players.append(player_id)
            player_data["status"] = "waiting_choice"  # Waiting for war/surrender choice
        else:
            player_data["result"] = result
            player_data["status"] = "finished"
            game_state["player_results"][player_id] = result
    await broadcast_to_all({
        "action": "round_dealt",
        "round_number": game_state["round_number"],
        "dealer_card": game_state["dealer_card"],
        "players": game_state["players"],
        "tie_players": tie_players,
        "deck_count": len(game_state["deck"]),
        "player_results": game_state["player_results"]
    })
    # In automatic mode, do NOT auto-surrender ties. Wait for manual choice.
    # If no ties, round is complete
    if not tie_players:
        await complete_round()

async def handle_player_choice(player_id, choice):
    """Handles player's choice for war or surrender."""
    if player_id not in game_state["players"]:
        return
    
    player = game_state["players"][player_id]
    
    if choice == "surrender":
        player["result"] = "surrender"
        player["status"] = "finished"
        game_state["player_results"][player_id] = "surrender"
    elif choice == "war":
        player["status"] = "war"
        player["card"] = None  
        # Do not assign a war card now; wait for dealer to assign during war round.
        # (Optionally, you can add the player to a war list if needed.)
    await broadcast_to_all({
        "action": "player_choice_made",
        "player_id": player_id,
        "choice": choice,
        "players": game_state["players"],
        "player_results": game_state["player_results"],
        "deck_count": len(game_state["deck"])
    })
    # In all modes, as soon as all non-war players have finished, proceed automatically
    all_non_war_finished = all(
        p["status"] != "waiting_choice" for p in game_state["players"].values() if p["status"] != "war"
    )
    if all_non_war_finished:
        war_players = [pid for pid, p in game_state["players"].items() if p["status"] == "war"]
        if war_players:
            if game_state["game_mode"] == "automatic":
                # In automatic mode, assign war cards and evaluate automatically
                await assign_and_evaluate_war_round(war_players)
            else:
                await start_war_round(war_players)
        else:
            await complete_round()

async def assign_and_evaluate_war_round(war_players):
    """Automatically assign war cards to dealer and war players, then evaluate only new cards for war participants."""
    # Assign war cards to all war players
    for player_id in war_players:
        if game_state["deck"]:
            card = game_state["deck"].pop(0)
            game_state["players"][player_id]["war_card"] = card
    # Assign new war card to dealer
    dealer_war_card = None
    if game_state["deck"]:
        dealer_war_card = game_state["deck"].pop(0)
    # Prepare war_round structure for evaluation (only war players)
    war_round = {
        "dealer_card": dealer_war_card,
        "players": {pid: game_state["players"][pid]["war_card"] for pid in war_players}
    }
    # Store for UI (for display purposes, keep original cards in game_state["war_round"])
    game_state["war_round_active"] = False
    game_state["war_round"] = {
        "dealer_card": dealer_war_card,
        "players": {pid: game_state["players"][pid]["war_card"] for pid in war_players},
        "original_cards": {
            "dealer_card": game_state["dealer_card"],
            "players": {pid: game_state["players"][pid]["card"] for pid in game_state["players"]}
        }
    }
    # Evaluate war round (only war players)
    await evaluate_war_round_auto(war_round, war_players)

async def evaluate_war_round_auto(war_round, war_players):
    dealer_war_card = war_round["dealer_card"]
    war_players_cards = war_round["players"]
    # Evaluate results for players in war round (only war players)
    for player_id, card in war_players_cards.items():
        result = compare_cards(card, dealer_war_card)
        # Update the player's result and mark as finished.
        game_state["players"][player_id]["result"] = result
        game_state["players"][player_id]["status"] = "finished"
        game_state["players"][player_id]["war_card"] = card
        game_state["player_results"][player_id] = result
    # Broadcast war round evaluated (only war players updated, others remain for UI)
    await broadcast_to_all({
        "action": "war_round_evaluated",
        "dealer_card": dealer_war_card,
        "players": { pid: game_state["players"][pid] for pid in war_players },
        "player_results": game_state["player_results"],
        "message": "War round evaluated"
    })
    # Complete round if all finished
    all_finished = all(p["status"] == "finished" for p in game_state["players"].values())
    if all_finished:
        await complete_round()

async def start_war_round(war_players):
    # Indicate war round is active.
    game_state["war_round_active"] = True
    # Create a new war_round state holding dealer's and war players' cards.
    game_state["war_round"] = {
        "dealer_card": None,
        "players": { pid: None for pid in war_players }
    }
    await broadcast_to_all({
        "action": "war_round_started",
        "war_round": game_state["war_round"],
        "players": war_players,
        "message": "War round started for players: " + ", ".join(war_players)
    })
    
async def handle_assign_war_card(target, card, player_id=None):
    # Only allow if war round is active
    if not game_state.get("war_round_active") or not game_state.get("war_round"):
        return

    # Assign the card to the correct target in war_round
    if target == "dealer":
        game_state["war_round"]["dealer_card"] = card
        # Broadcast to all clients that dealer's war card is assigned
        await broadcast_to_all({
            "action": "war_card_assigned",
            "target": "dealer",
            "card": card
        })
    elif target == "player" and player_id:
        if player_id in game_state["war_round"]["players"]:
            game_state["war_round"]["players"][player_id] = card
            # Broadcast to all clients that player's war card is assigned
            await broadcast_to_all({
                "action": "war_card_assigned",
                "target": "player",
                "card": card,
                "player_id": player_id
            })
    # Optionally: you could trigger war round evaluation here if all cards are assigned

async def evaluate_war_round():
    war = game_state.get("war_round", {})
    dealer_war_card = war.get("dealer_card")
    war_players_cards = war.get("players", {})
    if dealer_war_card is None or any(c is None for c in war_players_cards.values()):
        await broadcast_to_dealers({
            "action": "error",
            "message": "Not all war cards assigned. Cannot evaluate war round."
        })
        return

    # Evaluate results for players in war round.
    for player_id, card in war_players_cards.items():
        result = compare_cards(card, dealer_war_card)
        # Update the player's result and mark as finished.
        game_state["players"][player_id]["result"] = result
        game_state["players"][player_id]["status"] = "finished"
        game_state["players"][player_id]["war_card"] = card
        game_state["player_results"][player_id] = result

    # Clear war round state.
    game_state["war_round_active"] = False
    game_state["war_round"] = {}
    await broadcast_to_all({
        "action": "war_round_evaluated",
        "dealer_card": dealer_war_card,
        "players": { pid: game_state["players"][pid] for pid in war_players_cards.keys() },
        "player_results": game_state["player_results"],
        "message": "War round evaluated"
    })
    # Optionally call complete_round() if all players are now finished.
    all_finished = all(p["status"] == "finished" for p in game_state["players"].values())
    if all_finished:
        await complete_round()

async def complete_round():
    """Completes the current round and saves results."""
    game_state["round_active"] = False
    
    # Save results to MONGODB
    for player_id, player_data in game_state["players"].items():
        if player_data["result"]:
            result_record = {
                "round_number": game_state["round_number"],
                "player_id": player_id,
                "player_card": player_data["card"],
                "war_card": player_data.get("war_card"),
                "dealer_card": game_state["dealer_card"],
                "result": player_data["result"],
                "timestamp": datetime.utcnow(),
                "table_number": game_state["table_number"],
                "game_mode": game_state["game_mode"]
            }
            try:
                print(f"[MONGODB] Attempting to insert: {result_record}")
                insert_result = await results_collection.insert_one(result_record)
                print(f"[MONGODB] Inserted document with _id: {insert_result.inserted_id}")
            except Exception as e:
                print(f"[MONGODB ERROR] Failed to insert result for player {player_id}: {e}")
    
    await broadcast_to_all({
        "action": "round_completed",
        "round_number": game_state["round_number"],
        "player_results": game_state["player_results"]
    })
    
async def handle_start_auto_round():
    """Starts an automatic round: assigns cards to all players and evaluates the round."""
    if game_state["game_mode"] != "automatic":
        await broadcast_to_dealers({"action": "error", "message": "Not in automatic mode"})
        return
    if game_state["round_active"]:
        await broadcast_to_dealers({"action": "error", "message": "Round already active"})
        return
    if not game_state["players"]:
        await broadcast_to_dealers({"action": "error", "message": "No players to start round"})
        return
    # Assign cards and evaluate
    await deal_cards_internal()

async def handle_clear_round():
    """Resets the round for the next auto round, keeps players but clears cards/statuses/results."""
    if game_state["game_mode"] != "automatic" and game_state["game_mode"] != "live":
        await broadcast_to_dealers({"action": "error", "message": "Not in automatic or live mode"})
        return
    # Always allow reset, regardless of round_active or player statuses
    for player in game_state["players"].values():
        player["card"] = None
        player["status"] = "active"
        player["result"] = None
        player["war_card"] = None
    game_state["dealer_card"] = None
    game_state["war_round_active"] = False
    game_state["war_round"] = {"dealer_card": None, "players": {}}
    game_state["round_active"] = False  # Ensure round_active is always reset so START is available
    # Do not reset round_number or remove players
    await broadcast_to_all({
        "action": "game_state_update",
        "game_state": {
            "deck_count": len(game_state["deck"]),
            "burned_cards_count": len(game_state["burned_cards"]),
            "dealer_card": game_state["dealer_card"],
            "players": game_state["players"],
            "round_active": game_state["round_active"],
            "round_number": game_state["round_number"],
            "game_mode": game_state["game_mode"],
            "table_number": game_state["table_number"],
            "min_bet": game_state["min_bet"],
            "max_bet": game_state["max_bet"],
            "player_results": game_state["player_results"]
        }
    })

async def handle_reset_game():
    """Resets the entire game state."""
    game_state.update({
        "deck": [],
        "burned_cards": [],
        "dealer_card": None,
        "players": {},
        "round_active": False,
        "round_number": 0,
        "player_results": {},
        "war_round_active": False,     # Reset war round flag
        "war_round": {                 # Reset war round state
            "dealer_card": None,
            "players": {}
        }
    })
    
    await broadcast_to_all({
        "action": "game_reset",
        "game_state": game_state
    })

async def handle_change_bets(min_bet, max_bet):
    """Changes the betting limits."""
    game_state["min_bet"] = min_bet
    game_state["max_bet"] = max_bet
    
    await broadcast_to_all({
        "action": "bets_changed",
        "min_bet": min_bet,
        "max_bet": max_bet
    })

async def handle_change_table(table_number):
    """Changes the table number."""
    game_state["table_number"] = table_number
    
    await broadcast_to_all({
        "action": "table_changed",
        "table_number": table_number
    })

async def handle_undo_last_card():
    """Undoes the last dealt card (dealer or any player), based on true assignment order."""
    # Track assignment order in game_state
    if "assignment_order" not in game_state:
        game_state["assignment_order"] = []

    # Find the last assignment
    if not game_state["assignment_order"]:
        await broadcast_to_all({
            "action": "cards_undone",
            "deck_count": len(game_state["deck"]),
            "players": game_state["players"],
            "dealer_card": game_state["dealer_card"],
            "message": "No card to undo"
        })
        return

    last = game_state["assignment_order"].pop()
    last_card = None
    last_type = last["type"]
    last_player_id = last.get("player_id")

    if last_type == "dealer":
        last_card = game_state["dealer_card"]
        game_state["dealer_card"] = None
    elif last_type == "player" and last_player_id:
        player = game_state["players"].get(last_player_id)
        if player and player.get("card"):
            last_card = player["card"]
            player["card"] = None
            player["status"] = "active"
            player["result"] = None
            player["war_card"] = None

    if last_card:
        game_state["deck"].insert(0, last_card)

    await broadcast_to_all({
        "action": "cards_undone",
        "deck_count": len(game_state["deck"]),
        "players": game_state["players"],
        "dealer_card": game_state["dealer_card"],
        "message": f"Last card ({last_card}) unassigned from {'dealer' if last_type == 'dealer' else 'player ' + str(last_player_id) if last_player_id else ''} and put back to deck" if last_card else "No card to undo"
    })

async def handle_add_card_manual(card):
    """Manually adds a card (for testing purposes)."""
    game_state["deck"].insert(0, card)
    
    await broadcast_to_dealers({
        "action": "card_added_manually",
        "card": card,
        "deck_count": len(game_state["deck"])
    })

async def handle_set_game_mode(mode):
    """Sets the game mode (manual, automatic, live)."""
    game_state["game_mode"] = mode
    
    # Stop any running automatic mode
    if hasattr(game_state, 'auto_task') and game_state['auto_task']:
        game_state['auto_task'].cancel()
        game_state['auto_task'] = None
    
    # Start automatic mode if selected
    # if mode == "automatic":
        # game_state['auto_task'] = asyncio.create_task(run_automatic_mode())
    
    await broadcast_to_all({
        "action": "game_mode_changed",
        "mode": mode
    })

async def handle_manual_deal_card(target, card, player_id=None):
    """Manually assigns a card to the dealer or a specified player in live mode."""
    if game_state["game_mode"] != "live":
        await broadcast_to_dealers({"action": "error", "message": "Manual card assignment allowed only in live mode"})
        return
    if "assignment_order" not in game_state:
        game_state["assignment_order"] = []
    # Remove the card from the deck if present
    if card in game_state["deck"]:
        game_state["deck"].remove(card)
    if target == "dealer":
        game_state["dealer_card"] = card
        game_state["assignment_order"].append({"card": card, "type": "dealer"})
        await broadcast_to_all({
            "action": "dealer_card_set",
            "card": card,
            "message": "Dealer card manually set",
            "game_state": game_state
        })
    elif target == "player":
        if not player_id or player_id not in game_state["players"]:
            await broadcast_to_dealers({
                "action": "error",
                "message": f"Player {player_id} not found."
            })
            return
        game_state["players"][player_id]["card"] = card
        game_state["players"][player_id]["status"] = "active"
        game_state["assignment_order"].append({"player_id": player_id, "card": card, "type": "player"})
        await broadcast_to_all({
            "action": "player_card_set",
            "player_id": player_id,
            "card": card,
            "message": f"Card manually assigned to player {player_id}",
            "game_state": game_state
        })

async def broadcast_to_all(message):
    """Broadcasts message to all connected clients."""
    if connected_clients:
        await asyncio.gather(
            *[client.send(json.dumps(message)) for client in connected_clients],
            return_exceptions=True
        )

async def broadcast_to_dealers(message):
    """Broadcasts message only to dealer clients."""
    if dealer_clients:
        await asyncio.gather(
            *[client.send(json.dumps(message)) for client in dealer_clients],
            return_exceptions=True
        )

async def broadcast_to_player(player_id, message):
    """Broadcasts message to a specific player."""
    if player_id in player_clients:
        try:
            await player_clients[player_id].send(json.dumps(message))
        except websockets.ConnectionClosed:
            del player_clients[player_id]

# DELETE DATA FROM MONGODB
async def delete_recent_result():
    """Deletes the most recent game result from MongoDB."""
    last_result = await results_collection.find_one(sort=[("timestamp", -1)])
    if last_result:
        result = await results_collection.delete_one({"_id": last_result["_id"]})
        if result.deleted_count > 0:
            pass

async def delete_all_results():
    """Deletes all game results from MongoDB."""
    result = await results_collection.delete_many({})
    if result.deleted_count > 0:
        await broadcast_to_dealers({
            "action": "all_results_deleted",
            "deleted_count": result.deleted_count
        })
# ENDS
async def main():
    """Starts the WebSocket server."""
    async with websockets.serve(handle_connection, "localhost", 6789):
        print("WebSocket server running on ws://localhost:6789")
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    asyncio.run(main())

# def extract_card_value(input_string):
#     """
#     Extract the card value from the input string formatted like:
#     [Manual Burn Cards]<Card:{data}>
#     """
#     match = re.search(r"<Card:(.*?)>", input_string)
#     return match.group(1) if match else None

# async def read_from_serial():
#     """Continuously reads card values from the casino shoe reader and adds them to the game."""
#     while True:
#         if ser.in_waiting > 0:
#             raw_data = ser.readline().decode("utf-8").strip()
#             card = extract_card_value(raw_data)
#             print ("card:",card)
#             if card:
#                 await handle_add_card(card)
#         await asyncio.sleep(0.1)  # Adjust delay if necessary

# async def main():
#     print("Connected to:", ser.name)
#     """Starts the WebSocket server and serial reader."""
#     server = websockets.serve(handle_connection, "0.0.0.0", 6789)
#     print("WebSocket server running on ws://localhost:6789")

#     await asyncio.gather(server, read_from_serial())  # Run both tasks concurrently