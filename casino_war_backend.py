import asyncio
import websockets
import json
import motor.motor_asyncio
from datetime import datetime
import random
import time
import re
import urllib.parse
import serial

# ser = serial.Serial("COM1", 9600, timeout=0.1)  # Adjust baud rate if necessary

# MongoDB setup
MONGO_URI = "mongod# b://localhost:27017"
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
    "round_number": 1,  # Start from 1, not 0
    "game_mode": "manual",  # manual, automatic, live
    "table_number": 1,
    "min_bet": 10,
    "max_bet": 1000,
    "player_results": {},  # {player_id: last_result} for display screen    
    "auto_task": None,  # For automatic mode task
    "auto_round_delay": 5,  # Seconds between automatic rounds
    "auto_choice_delay": 3,  # Seconds to wait for player choices before auto-surrender
    "shoe_first_card_burned": False,  # Flag to track if first card from shoe reader is burned
}

# In-memory session stats (not MongoDB)
session_stats = {}

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

# Simple stats retrieval for player registration/refresh
async def get_player_stats_simple(player_id=None):
    """Fetches win/loss/tie/surrender/total_games for a player from MongoDB."""
    try:
        if player_id:
            pipeline = [
                {"$match": {"player_id": player_id}},
                {"$group": {
                    "_id": "$player_id",
                    "wins": {"$sum": {"$cond": [{"$eq": ["$result", "win"]}, 1, 0]}},
                    "losses": {"$sum": {"$cond": [{"$eq": ["$result", "lose"]}, 1, 0]}},
                    "ties": {"$sum": {"$cond": [{"$eq": ["$result", "tie"]}, 1, 0]}},
                    "surrenders": {"$sum": {"$cond": [{"$eq": ["$result", "surrender"]}, 1, 0]}},
                    "total_games": {"$sum": 1}
                }}
            ]
            cursor = results_collection.aggregate(pipeline)
            result = await cursor.to_list(length=1)
            if result:
                doc = result[0]
                return {
                    "wins": doc["wins"],
                    "losses": doc["losses"],
                    "ties": doc["ties"],
                    "surrenders": doc["surrenders"],
                    "total_games": doc["total_games"]
                }
        return {"wins": 0, "losses": 0, "ties": 0, "surrenders": 0, "total_games": 0}
    except Exception as e:
        print(f"[MONGODB ERROR] Failed to retrieve player stats: {e}")
        return {"wins": 0, "losses": 0, "ties": 0, "surrenders": 0, "total_games": 0}

async def get_all_player_stats():
    """Fetches stats for all players in the current game from MongoDB."""
    stats = {}
    try:
        player_ids = list(game_state["players"].keys())
        for pid in player_ids:
            stats[pid] = await get_player_stats_simple(pid)
    except Exception as e:
        print(f"[MONGODB ERROR] Failed to retrieve all player stats: {e}")
    return stats

async def get_session_stats():
    return dict(session_stats)

async def update_session_stats(player_results):
    for player_id, result in player_results.items():
        if player_id not in session_stats:
            session_stats[player_id] = {"wins": 0, "losses": 0, "ties": 0, "surrenders": 0}
        if result == "win":
            session_stats[player_id]["wins"] += 1
        elif result == "lose":
            session_stats[player_id]["losses"] += 1
        elif result == "surrender":
            session_stats[player_id]["surrenders"] += 1
        elif result == "tie":
            session_stats[player_id]["ties"] += 1

async def clear_session_stats():
    session_stats.clear()

async def handle_connection(websocket, path=None):
    """Handles new client connections."""
    connected_clients.add(websocket)
    print(f"Client connected: {websocket.remote_address}")
    
    # Send current game state to new client (INCLUDE WAR ROUND STATE IF ACTIVE)
    stats = await get_session_stats()
    game_state_update = {
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
    # PATCH: Always include war round state if present
    if game_state.get("war_round_active") or (game_state.get("war_round") and game_state["war_round"]):
        game_state_update["war_round_active"] = game_state.get("war_round_active", False)
        game_state_update["war_round"] = game_state.get("war_round", None)
    await websocket.send(json.dumps({
        "action": "game_state_update",
        "game_state": game_state_update,
        "stats": stats
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
                player_stats = await get_player_stats_simple(player_id)
                await websocket.send(json.dumps({
                    "action": "player_registered",
                    "player_id": player_id,
                    "stats": player_stats
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
                
            # elif data["action"] == "live_card_scanned":
            #     await handle_live_card_scan(data["card"])

            # elif data["action"] == "live_war_card_scanned": 
            #     await handle_live_war_card_scan(data["card"])
            
            elif data["action"] == "assign_war_card":
                await handle_assign_war_card(data["target"], data["card"], data.get("player_id"))
            elif data["action"] == "evaluate_war_round":
                await evaluate_war_round()
                
            elif data["action"] == "manual_deal_card":
                await handle_manual_deal_card(data["target"], data["card"], data.get("player_id"))
#new handle connection for manual evalatuation            elif data["action"] == "evaluate_round":
                # Check that every active (added) player has a card assigned AND dealer has a card.
                incomplete = [pid for pid, pdata in game_state["players"].items() if pdata.get("card") is None]
                dealer_missing = game_state["dealer_card"] is None
                if incomplete or dealer_missing:
                    missing_msg = ""
                    if incomplete:
                        missing_msg += f"Players {', '.join(incomplete)} have not been assigned a card. "
                    if dealer_missing:
                        missing_msg += "Dealer has not been assigned a card."
                    await broadcast_to_dealers({
                        "action": "error",
                        "message": missing_msg.strip()
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
    """Shuffles the deck."""
    game_state["deck"] = create_deck()
    game_state["burned_cards"] = []
    
    await broadcast_to_all({
        "action": "deck_shuffled",
        "deck_count": len(game_state["deck"]),
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

async def deal_cards_internal(increment_round=True):
    """Internal function to deal cards (used by all modes)."""
    if not game_state["deck"]:
        await broadcast_to_dealers({"action": "error", "message": "No cards left in deck"})
        return False
    
    if len(game_state["deck"]) < len(game_state["players"]) + 1:
        await broadcast_to_dealers({"action": "error", "message": "Not enough cards for all players and dealer"})
        return False
    
    if increment_round:
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
        # Do NOT set player["card"] = None; keep original card for UI
        # player["card"] remains as the original card
        # war_card will be set later
    await broadcast_to_all({
        "action": "player_choice_made",
        "player_id": player_id,
        "choice": choice,
        "players": game_state["players"],
        "player_results": game_state["player_results"],
        "deck_count": len(game_state["deck"])
    })
    # NEW: Always broadcast full game state update so dealer sees status change
    await broadcast_game_state_update()
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

async def start_war_round(war_players):
    """Starts a war round for the given players."""
    game_state["war_round_active"] = True
    game_state["war_round"] = {
        "dealer_card": None,
        "players": {pid: None for pid in war_players},
        "original_cards": {
            "dealer_card": game_state["dealer_card"],
            "players": {pid: game_state["players"][pid]["card"] for pid in game_state["players"]}
        }
    }
    await broadcast_to_all({
        "action": "war_round_started",
        "players": war_players,
        "war_round": game_state["war_round"]
    })

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
    # Ensure that only war players' results are updated; others remain unchanged
    # Broadcast war round evaluated (only war players updated, others remain for UI)
    await broadcast_to_all({
        "action": "war_round_evaluated",
        "dealer_card": dealer_war_card,
        "players": { pid: game_state["players"][pid] for pid in war_players },
        "player_results": dict(game_state["player_results"]),
        "message": "War round evaluated"
    })
    # Complete round if all finished
    all_finished = all(p["status"] == "finished" for p in game_state["players"].values())
    if all_finished:
        await complete_round()

async def handle_assign_war_card(target, card, player_id=None):
    """Assigns a war card to a player or dealer during a war round."""
    war = game_state.get("war_round")
    if not war or not game_state.get("war_round_active"):
        await broadcast_to_dealers({"action": "error", "message": "No active war round."})
        return
    if card not in game_state["deck"]:
        await broadcast_to_dealers({"action": "error", "message": f"Card {card} not available in deck."})
        return
    game_state["deck"].remove(card)
    if target == "dealer":
        war["dealer_card"] = card
    elif target == "player" and player_id:
        war["players"][player_id] = card
    else:
        await broadcast_to_dealers({"action": "error", "message": "Invalid war card assignment target."})
        return
    await broadcast_to_all({
        "action": "war_card_assigned",
        "target": target,
        "card": card,
        "player_id": player_id
    })

async def evaluate_war_round():
    """Evaluates the war round using assigned war cards."""
    war = game_state.get("war_round")
    if not war or not game_state.get("war_round_active"):
        await broadcast_to_dealers({"action": "error", "message": "No active war round to evaluate."})
        return
    dealer_card = war.get("dealer_card")
    player_cards = war.get("players", {})
    # PATCH: Check for missing war cards (None) after undo
    if not dealer_card or any(card is None for card in player_cards.values()):
        await broadcast_to_dealers({"action": "error", "message": "Not all war cards assigned."})
        return
    # Evaluate results for each war player
    for pid, card in player_cards.items():
        result = compare_cards(card, dealer_card)
        game_state["players"][pid]["result"] = result
        game_state["players"][pid]["status"] = "finished"
        game_state["players"][pid]["war_card"] = card
        game_state["player_results"][pid] = result
    # PATCH: Preserve original_cards after evaluation
    original_cards = war.get("original_cards")
    game_state["war_round_active"] = False
    game_state["war_round"] = {
        "dealer_card": dealer_card,
        "players": dict(player_cards),
        "original_cards": original_cards  # Always preserve
    }
    # Broadcast war round evaluated
    await broadcast_to_all({
        "action": "war_round_evaluated",
        "dealer_card": dealer_card,
        "players": {pid: game_state["players"][pid] for pid in player_cards},
        "player_results": dict(game_state["player_results"]),
        "war_round": game_state["war_round"],
        "message": "War round evaluated"
    })
    # Complete round if all finished
    all_finished = all(p["status"] == "finished" for p in game_state["players"].values())
    if all_finished:
        await complete_round()

# PATCH: In complete_round, do not overwrite results for players who already have a result
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
                "min_bet": game_state["min_bet"],
                "max_bet": game_state["max_bet"],
                "game_mode": game_state["game_mode"]
            }
            try:
                print(f"[MONGODB] Attempting to insert: {result_record}")
                insert_result = await results_collection.insert_one(result_record)
                print(f"[MONGODB] Inserted document with _id: {insert_result.inserted_id}")
            except Exception as e:
                print(f"[MONGODB ERROR] Failed to insert result for player {player_id}: {e}")
    # Only update session stats for players whose result was just finalized
    await update_session_stats(game_state["player_results"])
    await broadcast_to_all({
        "action": "round_completed",
        "round_number": game_state["round_number"],
        "player_results": dict(game_state["player_results"]),
        "stats": dict(session_stats)  # Always include updated session stats
    })
    
async def handle_start_auto_round():
    """Starts an automatic round: burns one card first, then assigns cards to all players and evaluates the round, but only if all players and dealer have no cards assigned. Does NOT increment round number."""
    if game_state["game_mode"] != "automatic":
        await broadcast_to_dealers({"action": "error", "message": "Not in automatic mode"})
        return
    if game_state["round_active"]:
        await broadcast_to_dealers({"action": "error", "message": "Round already active"})
        return
    if not game_state["players"]:
        await broadcast_to_dealers({"action": "error", "message": "No players to start round"})
        return
    # Only allow if all players and dealer have no cards assigned
    players_have_cards = any(p["card"] is not None for p in game_state["players"].values())
    dealer_has_card = game_state["dealer_card"] is not None
    if players_have_cards or dealer_has_card:
        await broadcast_to_dealers({
            "action": "error",
            "message": "Cannot start: Some players or dealer already have cards assigned. Use 'NEW GAME' to reset first."
        })
        return
    # Check if we have enough cards (1 burn + 1 per player + 1 dealer)
    needed_cards = 1 + len(game_state["players"]) + 1
    if len(game_state["deck"]) < needed_cards:
        await broadcast_to_dealers({
            "action": "error", 
            "message": f"Not enough cards in deck. Need {needed_cards} cards (1 burn + {len(game_state['players'])} players + 1 dealer), but only {len(game_state['deck'])} available."
        })
        return
    # Burn one card first (the first card in automatic mode)
    if game_state["deck"]:
        burned_card = game_state["deck"].pop(0)
        game_state["burned_cards"].append(burned_card)
        await broadcast_to_all({
            "action": "card_burned",
            "burned_card": burned_card,
            "deck_count": len(game_state["deck"]),
            "burned_cards_count": len(game_state["burned_cards"]),
            "message": f"Card {burned_card} burned before automatic deal"
        })
    # Now assign cards and evaluate (do NOT increment round number)
    await deal_cards_internal(increment_round=False)

# Patch deal_cards_internal to allow skipping round number increment
async def deal_cards_internal(increment_round=True):
    """Internal function to deal cards (used by all modes)."""
    if not game_state["deck"]:
        await broadcast_to_dealers({"action": "error", "message": "No cards left in deck"})
        return False
    if len(game_state["deck"]) < len(game_state["players"]) + 1:
        await broadcast_to_dealers({"action": "error", "message": "Not enough cards for all players and dealer"})
        return False
    if increment_round:
        game_state["round_number"] += 1
    game_state["round_active"] = True
    for player_id in game_state["players"]:
        if game_state["deck"]:
            card = game_state["deck"].pop(0)
            game_state["players"][player_id]["card"] = card
            game_state["players"][player_id]["status"] = "active"
            game_state["players"][player_id]["result"] = None
            game_state["players"][player_id]["war_card"] = None
            game_state.setdefault("assignment_order", []).append({"player_id": player_id, "card": card, "type": "player"})
    if game_state["deck"]:
        game_state["dealer_card"] = game_state["deck"].pop(0)
        game_state["assignment_order"].append({"card": game_state["dealer_card"], "type": "dealer"})
    await evaluate_round()
    return True

async def handle_clear_round():
    """Resets the round for the next auto round, keeps players but clears cards/statuses/results, and increments round number."""
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
    game_state["round_active"] = False
    game_state["round_number"] = max(1, game_state["round_number"] + 1)  # Never below 1
    game_state["shoe_first_card_burned"] = False  # Reset shoe reader flag
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
    """Resets the entire game state, deck, and session stats."""
    game_state.update({
        "deck": create_deck(),  # Always reset to 312 cards
        "burned_cards": [],
        "dealer_card": None,
        "players": {},
        "round_active": False,
        "round_number": 1,  # Reset to 1, not 0
        "player_results": {},
        "war_round_active": False,     # Reset war round flag
        "war_round": {                 # Reset war round state
            "dealer_card": None,
            "players": {}
        },
        "shoe_first_card_burned": False,  # Reset shoe reader flag
    })
    # Clear session stats as well
    session_stats.clear()
    await broadcast_to_all({
        "action": "game_reset",
        "game_state": game_state,
        "stats": dict(session_stats)  # Send cleared stats to all clients
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
    """Undoes the last dealt card (dealer or any player), based on true assignment order. Now also supports war round assignments."""
    if "assignment_order" not in game_state:
        await broadcast_to_dealers({"action": "error", "message": "No assignment order to undo."})
        return

    if not game_state["assignment_order"]:
        await broadcast_to_dealers({"action": "error", "message": "No assignments to undo."})
        return

    last = game_state["assignment_order"].pop()
    last_card = None
    last_type = last["type"]
    last_player_id = last.get("player_id")
    last_is_war = last.get("war_round", False)

    # PATCH: Always include updated war_round in cards_undone broadcast if war card was undone
    war_round_before = game_state.get("war_round")
    war_round_active_before = game_state.get("war_round_active")

    if last_is_war:
        # Undo war round assignment
        war = game_state.get("war_round")
        if not war:
            await broadcast_to_dealers({"action": "error", "message": "No active war round to undo."})
            return
        if last_type == "dealer":
            last_card = war.get("dealer_card")
            if last_card:
                war["dealer_card"] = None
                game_state["deck"].insert(0, last_card)
        elif last_type == "player" and last_player_id:
            last_card = war["players"].get(last_player_id)
            if last_card:
                war["players"][last_player_id] = None
                game_state["deck"].insert(0, last_card)
        # PATCH: Always broadcast updated war_round
        await broadcast_to_all({
            "action": "cards_undone",
            "deck_count": len(game_state["deck"]),
            "players": game_state["players"],
            "dealer_card": game_state["dealer_card"],
            "war_round": game_state["war_round"],
            "war_round_active": game_state.get("war_round_active", False),
            "message": f"Last war card ({last_card}) unassigned from {'dealer' if last_type == 'dealer' else 'player ' + str(last_player_id) if last_player_id else ''} and put back to deck" if last_card else "No war card to undo"
        })
        return
    else:
        # Undo normal round assignment
        if last_type == "dealer":
            last_card = game_state["dealer_card"]
            if last_card:
                game_state["dealer_card"] = None
                game_state["deck"].insert(0, last_card)
        elif last_type == "player" and last_player_id:
            last_card = game_state["players"][last_player_id]["card"]
            if last_card:
                game_state["players"][last_player_id]["card"] = None
                game_state["players"][last_player_id]["status"] = "active"
                game_state["players"][last_player_id]["result"] = None
                game_state["players"][last_player_id]["war_card"] = None
                game_state["deck"].insert(0, last_card)
        await broadcast_to_all({
            "action": "cards_undone",
            "deck_count": len(game_state["deck"]),
            "players": game_state["players"],
            "dealer_card": game_state["dealer_card"],
            "war_round": game_state.get("war_round"),
            "war_round_active": game_state.get("war_round_active", False),
            "message": f"Last card ({last_card}) unassigned from {'dealer' if last_type == 'dealer' else 'player ' + str(last_player_id) if last_player_id else ''} and put back to deck" if last_card else "No card to undo"
        })
        return

async def handle_add_card_manual(card):
    """Manually adds a card (for testing purposes)."""
    game_state["deck"].insert(0, card)
    
    await broadcast_to_dealers({
        "action": "card_added_manually",
        "card": card,
        "deck_count": len(game_state["deck"])
    })

async def handle_set_game_mode(mode):
    """Sets the game mode and ensures deck is initialized if needed."""
    game_state["game_mode"] = mode
    # If starting fresh, initialize the deck
    if game_state.get("round_number", 0) == 0 or not game_state.get("deck"):
        game_state["deck"] = create_deck()
    # Stop any running automatic mode
    if hasattr(game_state, 'auto_task') and game_state['auto_task']:
        game_state['auto_task'].cancel()
        game_state['auto_task'] = None
    await broadcast_to_all({
        "action": "game_mode_changed",
        "mode": mode,
        "deck_count": len(game_state["deck"])
    })

def get_next_card_assignment_target():
    """Returns the next assignment target: (target_type, player_id or None)."""
    # Find lowest-numbered active player without a card
    active_players = [pid for pid, pdata in game_state["players"].items() if pdata["status"] == "active" and pdata["card"] is None]
    if active_players:
        # Sort numerically if possible, else lexicographically
        try:
            next_pid = sorted(active_players, key=lambda x: int(x))[0]
        except Exception:
            next_pid = sorted(active_players)[0]
        return ("player", next_pid)
    # If all players have cards, assign to dealer if not assigned
    if game_state["dealer_card"] is None:
        return ("dealer", None)
    # All assigned
    return (None, None)

def is_card_available(card):
    """Returns True if at least one copy of the card is left in the deck (max 6 per unique card in 312)."""
    return card in game_state["deck"]



# --- SERIAL CARD READER INTEGRATION (COMPATIBLE WITH BACKEND ASSIGNMENT LOGIC) ---
import re

# def get_next_war_card_assignment_target():
#     """Returns the next war card assignment target: (target_type, player_id or None)."""
#     war = game_state.get("war_round", {})
#     if not war:
#         return (None, None)
#     # Find lowest-numbered war player without a war card
#     war_players = [pid for pid, card in war.get("players", {}).items() if card is None]
#     if war_players:
#         try:
#             next_pid = sorted(war_players, key=lambda x: int(x))[0]
#         except Exception:
#             next_pid = sorted(war_players)[0]
#         return ("player", next_pid)
#     # If all war players have cards, assign to dealer if not assigned
#     if war.get("dealer_card") is None:
#         return ("dealer", None)
#     return (None, None)

# Helper to get next war card assignment target
def get_next_war_card_assignment_target():
    """Returns the next war card assignment target: (target_type, player_id or None)."""
    war = game_state.get("war_round", {})
    if not war:
        return (None, None)
    # Find lowest-numbered war player without a war card
    war_players = [pid for pid, card in war.get("players", {}).items() if card is None]
    if war_players:
        try:
            next_pid = sorted(war_players, key=lambda x: int(x))[0]
        except Exception:
            next_pid = sorted(war_players)[0]
        return ("player", next_pid)
    # If all war players have cards, assign to dealer if not assigned
    if war.get("dealer_card") is None:
        return ("dealer", None)
    return (None, None)

# async def handle_live_card_scan(card):
#     """Assigns a scanned card to the next available player or dealer in order (main round). First card each round is burned."""
#     # Initialize the flag if not present
#     if "shoe_first_card_burned" not in game_state:
#         game_state["shoe_first_card_burned"] = False
#     # If first card of the round, burn it
#     if not game_state["shoe_first_card_burned"]:
#         if card in game_state["deck"]:
#             game_state["deck"].remove(card)
#             game_state["burned_cards"].append(card)
#         game_state["shoe_first_card_burned"] = True
#         await broadcast_to_all({
#             "action": "card_burned",
#             "burned_card": card,
#             "deck_count": len(game_state["deck"]),
#             "burned_cards_count": len(game_state["burned_cards"]),
#             "message": f"First card {card} burned from shoe reader"
#         })
#         return
#     # Otherwise, assign as normal
#     target, player_id = get_next_card_assignment_target()
#     if target is None:
#         await broadcast_to_dealers({
#             "action": "error",
#             "message": "All players and dealer already have cards assigned."
#         })
#         return
# # remove card from deck if present
#     if card in game_state["deck"]:
#         game_state["deck"].remove(card)
#     if target == "player":
#         game_state["players"][player_id]["card"] = card
#         game_state["players"][player_id]["status"] = "active"
#         game_state.setdefault("assignment_order", []).append({"player_id": player_id, "card": card, "type": "player"})
#         await broadcast_to_all({
#             "action": "player_card_set",
#             "player_id": player_id,
#             "card": card,
#             "message": f"Card assigned to player {player_id} via shoe scan",
#             "game_state": game_state
#         })
#     elif target == "dealer":
#         game_state["dealer_card"] = card
#         game_state.setdefault("assignment_order", []).append({"card": card, "type": "dealer"})
#         await broadcast_to_all({
#             "action": "dealer_card_set",
#             "card": card,
#             "message": "Dealer card assigned via shoe scan",
#             "game_state": game_state
#         })

# async def handle_live_war_card_scan(card):
#     """Assigns a scanned card to the next available war player or dealer in order (war round)."""
#     target, player_id = get_next_war_card_assignment_target()
#     war = game_state.get("war_round", {})
#     if target is None or not war:
#         await broadcast_to_dealers({
#             "action": "error",
#             "message": "All war cards already assigned."
#         })
#         return
#     if card in game_state["deck"]:
#         game_state["deck"].remove(card)
#     if target == "player":
#         war["players"][player_id] = card
#         await broadcast_to_all({
#             "action": "war_card_assigned",
#             "target": "player",
#             "card": card,
#             "player_id": player_id
#         })
#     elif target == "dealer":
#         war["dealer_card"] = card
#         await broadcast_to_all({
#             "action": "war_card_assigned",
#             "target": "dealer",
#             "card": card
#         })

def assign_card_if_available(card, error_context="assignment"):
    """Remove card from deck if available, else return False and send error."""
    if card not in game_state["deck"]:
        asyncio.create_task(broadcast_to_dealers({
            "action": "error",
            "message": f"Card {card} cannot be used for {error_context}: all 6 copies have already been assigned or burned."
        }))
        return False
    game_state["deck"].remove(card)
    return True

# PATCH: handle_manual_deal_card (covers manual override and live/shoereader)
async def handle_manual_deal_card(target, card, player_id=None):
    if game_state["game_mode"] != "live":
        await broadcast_to_dealers({"action": "error", "message": "Manual card assignment allowed only in live mode"})
        return
    # Allow assignment to any unassigned player or dealer (not just next in order)
    if not assign_card_if_available(card, "manual assignment"):
        return
    if target == "dealer":
        if game_state["dealer_card"] is not None:
            await broadcast_to_dealers({
                "action": "error",
                "message": "Dealer already has a card assigned."
            })
            return
        game_state["dealer_card"] = card
        game_state.setdefault("assignment_order", []).append({"card": card, "type": "dealer"})
        await broadcast_to_all({
            "action": "dealer_card_set",
            "card": card,
            "message": "Dealer card manually set",
            "game_state": game_state,
            "deck_count": len(game_state["deck"])
        })
    elif target == "player":
        if not player_id or player_id not in game_state["players"]:
            await broadcast_to_dealers({
                "action": "error",
                "message": f"Player {player_id} not found."
            })
            return
        if game_state["players"][player_id]["card"] is not None:
            await broadcast_to_dealers({
                "action": "error",
                "message": f"Player {player_id} already has a card assigned."
            })
            return
        game_state["players"][player_id]["card"] = card
        game_state["players"][player_id]["status"] = "active"
        game_state.setdefault("assignment_order", []).append({"player_id": player_id, "card": card, "type": "player"})
        await broadcast_to_all({
            "action": "player_card_set",
            "player_id": player_id,
            "card": card,
            "message": f"Card manually assigned to player {player_id}",
            "game_state": game_state,
            "deck_count": len(game_state["deck"])
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

async def broadcast_game_state_update():
    # PATCH: Always include war round state if present
    game_state_update = {
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
    if game_state.get("war_round_active") or (game_state.get("war_round") and game_state["war_round"]):
        game_state_update["war_round_active"] = game_state.get("war_round_active", False)
        game_state_update["war_round"] = game_state.get("war_round", None)
    await broadcast_to_all({
        "action": "game_state_update",
        "game_state": game_state_update
    })
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

# --- MAIN ENTRY POINT ---
if __name__ == "__main__":
    import sys
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    asyncio.run(main())

# OLD KRISHA CODE:
# def extract_card_value(input_string):
#     """
#     Extract the card value f# m the input string formatted like:
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

# Extract card value from serial input

def extract_card_value(input_string):
    """
    Extract the card value fr
om the input string formatted like:
    [Manual Burn Cards]<Card:{data}>
    """
    match = re.search(r"<Card:(.*?)>", input_string)
    return match.group(1) if match else None

# Serial reading logic (call backend assignment functions)
async def read_from_serial(ser, war_mode=False):
    """
    Continuously reads card values from the casino shoe reader and assigns them using backend logic.
    Set war_mode=True to assign war cards, else assigns main round cards.
    """
    while True:
        if ser.in_waiting > 0:
            raw_data = ser.readline().decode("utf-8").strip()
            card = extract_card_value(raw_data)
            print("card:", card)
            if card:
                if war_mode:
                    # Assign to next war target
                    target, player_id = get_next_war_card_assignment_target()
                    if target == "player":
                        await handle_assign_war_card("player", card, player_id)
                    elif target == "dealer":
                        await handle_assign_war_card("dealer", card)
                    else:
                        print("[SERIAL] All war cards assigned.")
                else:
                    # Assign to next main round target
                    target, player_id = get_next_card_assignment_target()
                    if target == "player":
                        await handle_manual_deal_card("player", card, player_id)
                    elif target == "dealer":
                        await handle_manual_deal_card("dealer", card)
                    else:
                        print("[SERIAL] All main round cards assigned.")
        await asyncio.sleep(0.1)  # Adjust delay if necessary

# Usage:
#   - For main round: await read_from_serial(ser, war_mode=False)
#   - For war round:  await read_from_serial(ser, war_mode=True)
# Replace 'ser' with your serial.Serial instance.