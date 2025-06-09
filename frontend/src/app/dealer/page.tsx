'use client'
import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface GameState {
  deck_count: number
  burned_cards_count: number
  dealer_card: string | null
  players: Record<string, PlayerData>
  round_active: boolean
  round_number: number
  game_mode: 'manual' | 'automatic' | 'live'
  table_number: number
  min_bet: number
  max_bet: number
  player_results: Record<string, string>
  war_round_active?: boolean
  war_round?: {
    dealer_card: string | null
    players: Record<string, string | null>
    original_cards?: {
      dealer_card: string | null
      players: Record<string, string | null>
    }
  }
}

interface PlayerData {
  card: string | null
  status: 'active' | 'war' | 'surrender' | 'waiting_choice' | 'finished'
  result: string | null
  war_card: string | null
}

export default function DealerPage() {
  const [gameState, setGameState] = useState<GameState>({
    deck_count: 0,
    burned_cards_count: 0,
    dealer_card: null,
    players: {},
    round_active: false,
    round_number: 0,
    game_mode: 'manual',
    table_number: 1,
    min_bet: 10,
    max_bet: 1000,
    player_results: {}
  })
  
  const [connected, setConnected] = useState(false)
  const [newPlayerId, setNewPlayerId] = useState('')
  const [minBet, setMinBet] = useState(10)
  const [maxBet, setMaxBet] = useState(1000)
  const [tableNumber, setTableNumber] = useState(1)
  const [manualCard, setManualCard] = useState('')
  const [notifications, setNotifications] = useState<string[]>([])
  const [warCardTarget, setWarCardTarget] = useState<'dealer' | 'player'>('dealer')
  const [warCardValue, setWarCardValue] = useState('')
  const [warPlayerId, setWarPlayerId] = useState('')
  
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    connectWebSocket()
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [])

  const connectWebSocket = () => {
    try {
      wsRef.current = new WebSocket('ws://localhost:6789')
      
      wsRef.current.onopen = () => {
        setConnected(true)
        sendMessage({ action: 'register_dealer' })
        addNotification('Connected to game server')
      }
      
      wsRef.current.onclose = () => {
        setConnected(false)
        addNotification('Disconnected from server')
        // Attempt to reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000)
      }
      
      wsRef.current.onmessage = (event) => {
        const data = JSON.parse(event.data)
        handleServerMessage(data)
      }
    } catch (error) {
      console.error('WebSocket connection error:', error)
      setConnected(false)
    }
  }

  const sendMessage = (message: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
    }
  }

  const addNotification = (message: string) => {
    setNotifications(prev => [...prev.slice(-4), message])
    setTimeout(() => {
      setNotifications(prev => prev.slice(1))
    }, 5000)
  }

  const handleServerMessage = (data: any) => {
    switch (data.action) {
      case 'game_state_update':
        setGameState(data.game_state)
        break
      case 'deck_shuffled':
        setGameState(prev => ({ 
          ...prev, 
          deck_count: data.deck_count,
          burned_cards_count: data.burned_cards_count 
        }))
        addNotification(`Deck shuffled - ${data.deck_count} cards remaining`)
        break
      case 'player_added':
        setGameState(prev => ({ ...prev, players: data.players }))
        addNotification(`Player ${data.player_id} added to game`)
        break
      case 'player_removed':
        setGameState(prev => ({ 
          ...prev, 
          players: data.players,
          player_results: data.player_results 
        }))
        addNotification(`Player ${data.player_id} removed from game`)
        break
      case 'round_dealt':
        setGameState(prev => ({ 
          ...prev, 
          dealer_card: data.dealer_card,
          players: data.players,
          round_number: data.round_number,
          deck_count: data.deck_count,
          player_results: data.player_results
        }))
        if (data.tie_players?.length > 0) {
          addNotification(`Tie with players: ${data.tie_players.join(', ')} - Choose War or Surrender`)
        }
        break
      case 'war_round_started':
        setGameState(prev => ({
          ...prev,
          war_round_active: true,
          war_round: {
            ...data.war_round,
            // Save the original cards for display
            original_cards: {
              dealer_card: prev.dealer_card,
              players: Object.fromEntries(
                ((data.players || []) as string[]).map((pid: string) => [pid, prev.players[pid]?.card || null])
              )
            }
          }
        }))
        addNotification(`War round started for: ${data.players.join(', ')}`)
        break
      case 'war_round_evaluated':
        setGameState(prev => ({
          ...prev,
          war_round_active: false,
          war_round: {
            ...prev.war_round,
            dealer_card: null,
            players: {},
            // Keep original_cards for display
            original_cards: prev.war_round?.original_cards
          },
          players: { ...prev.players, ...data.players },
          player_results: data.player_results
        }))
        addNotification('War round completed')
        break
      case 'round_completed':
        setGameState(prev => ({ 
          ...prev, 
          round_active: false,
          player_results: data.player_results
        }))
        addNotification(`Round ${data.round_number} completed`)
        break
      case 'game_mode_changed':
        setGameState(prev => ({ ...prev, game_mode: data.mode }))
        addNotification(`Game mode changed to ${data.mode}`)
        break
      case 'error':
        addNotification(`Error: ${data.message}`)
        break
      case 'game_reset':
        // Update the UI using the new game state from the server.
        setGameState(data.game_state)
        addNotification("Game has been reset")
        break
      case 'dealer_card_set':
        setGameState(prev => ({ 
          ...prev, 
          dealer_card: data.card 
        }))
        addNotification(`Dealer card manually set to ${data.card}`)
        break
      case 'player_card_set':
        setGameState(prev => ({ 
          ...prev, 
          players: { 
            ...prev.players, 
            [data.player_id]: { 
              ...prev.players[data.player_id], 
              card: data.card, 
              status: 'active' 
            } 
          } 
        }))
        addNotification(`Card manually assigned to player ${data.player_id}`)
        break
        case 'war_card_assigned':
          setGameState(prev => ({
            ...prev,
            war_round: {
              // If the message indicates the dealer's war card, update that; otherwise keep what was there
              dealer_card: data.target === 'dealer' ? data.card : (prev.war_round?.dealer_card ?? null),
              players: {
                ...prev.war_round?.players,
                // For player assignments use data.player_id (if provided)
                ...(data.target === 'player' && data.player_id ? { [data.player_id]: data.card } : {})
              }
            }
          }));
          addNotification(
            `War card ${data.card} assigned to ${data.target === 'dealer' ? 'Dealer' : 'Player ' + data.player_id}`
          
          );
        break;
      default:
        if (data.message) {
          addNotification(data.message)
        }
    }
  }

  const renderCard = (card: string | null, size: 'small' | 'medium' | 'large' = 'medium') => {
    if (!card) return null
    
    const rank = card[0]
    const suit = card[1]
    const suitSymbol = { 'S': '♠', 'H': '♥', 'D': '♦', 'C': '♣' }[suit] || suit
    const isRed = suit === 'H' || suit === 'D'
    
    const sizeClasses = {
      small: 'w-12 h-16 text-xs',
      medium: 'w-16 h-22 text-sm',
      large: 'w-20 h-28 text-base'
    }
    
    return (
      <motion.div
        initial={{ rotateY: 180, scale: 0.8 }}
        animate={{ rotateY: 0, scale: 1 }}
        transition={{ duration: 0.6 }}
        className={`card ${sizeClasses[size]} ${isRed ? 'text-red-600' : 'text-black'} flex flex-col justify-between p-1`}
      >
        <div className="text-left">
          <div className="font-bold">{rank}</div>
          <div className="text-lg leading-none">{suitSymbol}</div>
        </div>
        <div className="text-center text-2xl">{suitSymbol}</div>
        <div className="text-right rotate-180">
          <div className="font-bold">{rank}</div>
          <div className="text-lg leading-none">{suitSymbol}</div>
        </div>
      </motion.div>
    )
  }
  
  //THIS CODE SNIPPET CHANGE MADE SURE WAR PLAYERS ARE LISTED IN THE DROP DOWN
  const warPlayers = gameState.war_round && gameState.war_round.players
  ? Object.entries(gameState.war_round.players)
  : [];

  return (
    <div className="min-h-screen p-6">
      {/* Header */}
      {/* <div className="bg-black/40 backdrop-blur-sm border-2 border-casino-gold rounded-xl p-6 mb-6">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-gradient-conic from-red-500 via-yellow-500 to-blue-500 animate-spin-slow border-2 border-casino-gold"></div>
            <div>
              <h1 className="text-3xl font-bold text-casino-gold">Dealer Interface</h1>
              <p className="text-gray-300">Table {gameState.table_number} - {gameState.game_mode.toUpperCase()} Mode</p>
            </div>
          </div>
          <div className={`px-4 py-2 rounded-full flex items-center gap-2 ${connected ? 'bg-green-500/20 border border-green-500 text-green-400' : 'bg-red-500/20 border border-red-500 text-red-400'}`}>
            <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'} animate-pulse`}></div>
            {connected ? 'Connected' : 'Disconnected'}
          </div>
        </div>
      </div> */}


      {/* Player Management + Connection Status */}
      <div className="relative">
        {/* Connection Status in top right */}
        <div className="absolute top-4 right-4 z-10">
          <div className={`px-4 py-2 rounded-full flex items-center gap-2 ${connected ? 'bg-green-500/20 border border-green-500 text-green-400' : 'bg-red-500/20 border border-red-500 text-red-400'}`}>
        <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'} animate-pulse`}></div>
        {connected ? 'Connected' : 'Disconnected'}
          </div>
        </div>
        <div className="bg-black/40 backdrop-blur-sm border border-casino-gold rounded-xl p-6 mb-6">
          <h2 className="text-xl font-bold text-casino-gold mb-4">Player Management</h2>
          <div className="flex gap-4 justify-center">
        {Array.from({ length: 6 }, (_, i) => i + 1).map((seatNumber) => {
          const playerId = seatNumber.toString();
          const isActive = gameState.players[playerId] !== undefined;
          return (
            <button
          key={seatNumber}
          onClick={() => {
            if (isActive) {
              sendMessage({ action: "remove_player", player_id: playerId });
              addNotification(`Seat ${seatNumber} deactivated`);
            } else {
              sendMessage({ action: "add_player", player_id: playerId });
              addNotification(`Seat ${seatNumber} activated`);
            }
          }}
          className={`flex flex-col items-center justify-center border-2 rounded-xl p-4 transition-all duration-200 ${
            isActive 
              ? "bg-green-800 border-green-400 shadow-lg shadow-green-400/20"
              : "bg-gray-800 border-gray-600 hover:border-gray-400"
          }`}
            >
          <div className="text-4xl mb-2">
            {isActive ? "🟢" : "⚫"}
          </div>
          <div className="text-lg font-bold text-white">Seat {seatNumber}</div>
            </button>
          );
        })}
          </div>
        </div>
      </div>

      {/* Notifications */}
      <AnimatePresence>
        {notifications.map((notification, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, x: 300 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -300 }}
            className="fixed top-20 right-6 bg-casino-gold text-black px-4 py-2 rounded-lg shadow-lg z-50 mb-2"
            style={{ top: `${80 + index * 60}px` }}
          >
            {notification}
          </motion.div>
        ))}
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Game Controls */}
        <div className="lg:col-span-1">
          <div className="bg-black/40 backdrop-blur-sm border border-casino-gold rounded-xl p-6 mb-6">
            <h2 className="text-xl font-bold text-casino-gold mb-4">Game Controls</h2>
            
            {/* Deck Management */}
            <div className="space-y-3 mb-6">
              <button onClick={() => sendMessage({ action: 'shuffle_deck' })} className="dealer-button w-full">
                🔄 Shuffle Deck ({gameState.deck_count} cards)
              </button>
              <button onClick={() => sendMessage({ action: 'burn_card' })} className="w-full bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg transition-colors">
                🔥 Burn Card ({gameState.burned_cards_count} burned)
              </button>
            </div>

            {/* Game Mode */}
            <div className="mb-6">
              <label className="block text-casino-gold font-semibold mb-2">Game Mode</label>
              <select 
                value={gameState.game_mode} 
                onChange={(e) => sendMessage({ action: 'set_game_mode', mode: e.target.value })}
                className="w-full bg-black border border-casino-gold rounded-lg px-3 py-2 text-white"
              >
                <option value="manual">Manual</option>
                <option value="automatic">Automatic</option>
                <option value="live">Live</option>
              </select>
            </div>

            {/* Deal Cards */}
            <button 
              onClick={() => sendMessage({ action: 'deal_cards' })} 
              disabled={gameState.round_active || Object.keys(gameState.players).length === 0}
              className="dealer-button w-full mb-4 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              🎴 Deal Cards
            </button>

            {gameState.game_mode === 'live' && (
              <button 
                onClick={() => sendMessage({ action: 'evaluate_round' })} 
                className="success-button w-full mb-4"
              >
                ⚖️ Evaluate Round
              </button>
            )}

            {/* Utility Controls */}
            <div className="space-y-2">
              <button onClick={() => sendMessage({ action: 'undo_last_card' })} className="danger-button w-full">
                ↩️ Undo Last Deal
              </button>
              <button onClick={() => sendMessage({ action: 'reset_game' })} className="danger-button w-full">
                🔄 Reset Game
              </button>
            </div>
          </div>

          {/* Player Management */}
          {/* <div className="bg-black/40 backdrop-blur-sm border border-casino-gold rounded-xl p-6 mb-6">
            <h2 className="text-xl font-bold text-casino-gold mb-4">Player Management</h2>
            <div className="grid grid-cols-3 gap-4">
              {Array.from({ length: 6 }, (_, i) => i + 1).map((seatNumber) => {
                const playerId = seatNumber.toString();
                const isActive = gameState.players[playerId] !== undefined;
                return (
                  <button
                    key={seatNumber}
                    onClick={() => {
                      if (isActive) {
                        sendMessage({ action: "remove_player", player_id: playerId });
                        addNotification(`Seat ${seatNumber} deactivated`);
                      } else {
                        sendMessage({ action: "add_player", player_id: playerId });
                        addNotification(`Seat ${seatNumber} activated`);
                      }
                    }}
                    className={`flex flex-col items-center justify-center border-2 rounded-xl p-4 transition-all duration-200 ${
                      isActive 
                        ? "bg-green-800 border-green-400 shadow-lg shadow-green-400/20"
                        : "bg-gray-800 border-gray-600 hover:border-gray-400"
                    }`}
                  >
                    <div className="text-4xl mb-2">
                      {isActive ? "🟢" : "⚫"}
                    </div>
                    <div className="text-lg font-bold text-white">Seat {seatNumber}</div>
                  </button>
                );
              })}
            </div>
          </div> */}

          {/* Settings */}
          {/* <div className="bg-black/40 backdrop-blur-sm border border-casino-gold rounded-xl p-6">
            <h2 className="text-xl font-bold text-casino-gold mb-4">Table Settings</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-casino-gold font-semibold mb-1">Table Number</label>
                <div className="flex gap-2">
                  <input 
                    type="number" 
                    value={tableNumber}
                    onChange={(e) => setTableNumber(Number(e.target.value))}
                    className="flex-1 bg-black border border-casino-gold rounded-lg px-3 py-2 text-white"
                  />
                  <button onClick={() => sendMessage({ action: 'change_table', table_number: tableNumber })} className="success-button">
                    ✓
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-casino-gold font-semibold mb-1">Betting Limits</label>
                <div className="flex gap-2 mb-2">
                  <input 
                    type="number" 
                    placeholder="Min"
                    value={minBet}
                    onChange={(e) => setMinBet(Number(e.target.value))}
                    className="flex-1 bg-black border border-casino-gold rounded-lg px-3 py-2 text-white"
                  />
                  <input 
                    type="number" 
                    placeholder="Max"
                    value={maxBet}
                    onChange={(e) => setMaxBet(Number(e.target.value))}
                    className="flex-1 bg-black border border-casino-gold rounded-lg px-3 py-2 text-white"
                  />
                </div>
                <button onClick={() => sendMessage({ action: 'change_bets', min_bet: minBet, max_bet: maxBet })} className="success-button w-full">
                  Update Limits
                </button>
              </div>
            </div>
          </div> */}
        </div>

        {/* Game Table */}
        <div className="lg:col-span-2">
          <div className="bg-black/40 backdrop-blur-sm border border-casino-gold rounded-xl p-6 mb-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-casino-gold">
                Round {gameState.round_number} {gameState.round_active ? '(Active)' : ''}
              </h2>
              <div className="text-right">
                <div className="text-casino-gold font-semibold">Betting: ${gameState.min_bet} - ${gameState.max_bet}</div>
                <div className="text-gray-300 text-sm">Players: {Object.keys(gameState.players).length}/6</div>
              </div>
            </div>

            {/* Dealer Section */}
            {(!gameState.war_round_active || !gameState.war_round?.original_cards) ? (
              <div className="text-center mb-8">
                <h3 className="text-xl font-bold text-casino-gold mb-4">Dealer</h3>
                <div className="flex flex-col items-center justify-center">
                  {/* After war round, show both original and war card stacked */}
                  {(!gameState.war_round_active && gameState.war_round?.original_cards?.dealer_card) ? (
                    <div className="flex flex-col items-center gap-1">
                      {renderCard(gameState.war_round.original_cards.dealer_card, 'large')}
                      {gameState.war_round?.dealer_card && (
                        <div className="mt-1">{renderCard(gameState.war_round.dealer_card, 'large')}</div>
                      )}
                    </div>
                  ) :
                  // Normal round: show only the original card
                  gameState.dealer_card ? (
                    renderCard(gameState.dealer_card, 'large')
                  ) : (
                    <div className="w-20 h-28 card-back rounded-lg flex items-center justify-center">
                      <span className="text-white text-2xl">🎴</span>
                    </div>
                  )}
                </div>
                {/* Only show dealer card assignment input in live mode if round is active OR round is not active (before cards dealt) */}
                {gameState.game_mode === 'live' && (!gameState.round_active || gameState.round_active) && (
                  <div className="mt-4">
                    <input 
                      type="text" 
                      placeholder="Manual card (e.g., AS, KH)"
                      value={manualCard}
                      onChange={(e) => setManualCard(e.target.value.toUpperCase())}
                      className="bg-black border border-casino-gold rounded-lg px-3 py-2 text-white mr-2"
                    />
                    <button 
                      onClick={() => {
                        if (manualCard) {
                          const cardPattern = /^(10|[2-9]|[JQKA])[HDSC]$/;
                          if (!cardPattern.test(manualCard)) {
                            setNotifications(prev => [
                              ...prev.slice(-4),
                              "Invalid card. Please enter a valid card using ranks (2-10, J, Q, K, A) and suits (H, D, S, C)."
                            ]);
                            return;
                          }
                          sendMessage({ action: 'manual_deal_card', target: 'dealer', card: manualCard });
                          setManualCard('');
                        }
                      }}
                      className="success-button"
                    >
                      Set Dealer Card
                    </button>
                  </div>
                )}
              </div>
            ) : (
              // If war round is active, still show the dealer card assignment input in live mode ONLY if round is active
              gameState.game_mode === 'live' && gameState.round_active && (
                <div className="text-center mb-8">
                  <h3 className="text-xl font-bold text-casino-gold mb-4">Dealer</h3>
                  <div className="mt-4">
                    <input 
                      type="text" 
                      placeholder="Manual card (e.g., AS, KH)"
                      value={manualCard}
                      onChange={(e) => setManualCard(e.target.value.toUpperCase())}
                      className="bg-black border border-casino-gold rounded-lg px-3 py-2 text-white mr-2"
                    />
                    <button 
                      onClick={() => {
                        if (manualCard) {
                          const cardPattern = /^(10|[2-9]|[JQKA])[HDSC]$/;
                          if (!cardPattern.test(manualCard)) {
                            setNotifications(prev => [
                              ...prev.slice(-4),
                              "Invalid card. Please enter a valid card using ranks (2-10, J, Q, K, A) and suits (H, D, S, C)."
                            ]);
                            return;
                          }
                          sendMessage({ action: 'manual_deal_card', target: 'dealer', card: manualCard });
                          setManualCard('');
                        }
                      }}
                      className="success-button"
                    >
                      Set Dealer Card
                    </button>
                  </div>
                </div>
              )
            )}

            {/* War Round Section */}
            {gameState.war_round_active && (
              <div className="bg-red-900/30 border-2 border-red-500 rounded-xl p-6 mb-8">
                <h3 className="text-xl font-bold text-red-400 mb-4 text-center">⚔️ WAR ROUND ⚔️</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* War Dealer Card */}
                  <div className="text-center">
                    <h4 className="text-lg font-semibold text-red-400 mb-2">Dealer War Card</h4>
                    <div className="flex justify-center mb-4">
                      {gameState.war_round?.dealer_card ? (
                        renderCard(gameState.war_round.dealer_card, 'medium')
                      ) : (
                        <div className="w-16 h-22 card-back rounded-lg flex items-center justify-center">
                          <span className="text-white">🎴</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* War Player Cards */}
                  <div className="text-center">
                    <h4 className="text-lg font-semibold text-red-400 mb-2">Player War Cards</h4>
                    <div className="space-y-2">
                      {gameState.war_round && Object.entries(gameState.war_round.players).map(([playerId, card]) => (
                        <div key={playerId} className="flex items-center justify-between bg-black/30 rounded-lg p-2">
                          <span className="text-white">{playerId}</span>
                          <div className="flex items-center gap-2">
                            {card ? renderCard(card, 'small') : (
                              <div className="w-12 h-16 card-back rounded flex items-center justify-center">
                                <span className="text-white text-xs">🎴</span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* War Card Assignment Controls */}
                <div className="mt-6 p-4 bg-black/30 rounded-lg">
                  <h4 className="text-lg font-semibold text-casino-gold mb-3">Assign War Cards</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <select 
                      value={warCardTarget} 
                      onChange={(e) => setWarCardTarget(e.target.value as 'dealer' | 'player')}
                      className="bg-black border border-casino-gold rounded-lg px-3 py-2 text-white"
                    >
                      <option value="dealer">Dealer</option>
                      <option value="player">Player</option>
                    </select>
                    
                    {warCardTarget === 'player' && (
                      <select 
                        value={warPlayerId} 
                        onChange={(e) => setWarPlayerId(e.target.value)}
                        className="bg-black border border-casino-gold rounded-lg px-3 py-2 text-white"
                      >
                        <option value="">Select Player</option>
                        {warPlayers.map(([playerId]) => (
                          <option key={playerId} value={playerId}>{playerId}</option>
                        ))}
                      </select>
                    )}
                    
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        placeholder="Card (e.g., AS, KH)"
                        value={warCardValue}
                        onChange={(e) => setWarCardValue(e.target.value.toUpperCase())}
                        className="flex-1 bg-black border border-casino-gold rounded-lg px-3 py-2 text-white"
                      />
                      <button 
                        onClick={() => {
                          if (!warCardValue || (warCardTarget === 'player' && !warPlayerId)) {
                            setNotifications(prev => [
                              ...prev.slice(-4),
                              "Please enter a card value and select a player if target is Player."
                            ]);
                            return;
                          }
                          const cardPattern = /^(10|[2-9]|[JQKA])[HDSC]$/;
                          if (!cardPattern.test(warCardValue)) {
                            setNotifications(prev => [
                              ...prev.slice(-4),
                              "Invalid card. Please enter a valid card using ranks (2-10, J, Q, K, A) and suits (H, D, S, C)."
                            ]);
                            return;
                          }
                          sendMessage({ 
                            action: 'assign_war_card', 
                            target: warCardTarget, 
                            card: warCardValue,
                            player_id: warCardTarget === 'player' ? warPlayerId : undefined
                          });
                          setWarCardValue('');
                          setWarPlayerId('');
                        }}
                        className="success-button"
                      >
                        Assign
                      </button>
                    </div>
                  </div>
                  
                  <button 
                    onClick={() => sendMessage({ action: 'evaluate_war_round' })}
                    className="mt-4 w-full bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors font-semibold"
                  >
                    ⚖️ Evaluate War Round
                  </button>
                </div>
              </div>
            )}

            {/* Original Cards Section */}
            {gameState.war_round_active && gameState.war_round?.original_cards && (
              <div className="bg-yellow-900/20 border-2 border-yellow-500 rounded-xl p-4 mb-4">
                <h4 className="text-lg font-semibold text-yellow-400 mb-2 text-center">Original Cards That Caused the Tie</h4>
                <div className="flex flex-wrap justify-center gap-8">
                  <div className="text-center">
                    <div className="text-yellow-400 font-bold mb-1">Dealer</div>
                    {renderCard(gameState.war_round.original_cards.dealer_card, 'large')}
                  </div>
                  {Object.entries(gameState.war_round.original_cards.players).map(([pid, card]) => (
                    <div key={pid} className="text-center">
                      <div className="text-yellow-400 font-bold mb-1">Player {pid}</div>
                      {renderCard(card, 'large')}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Players Section */}
            {(!gameState.war_round_active || !gameState.war_round?.original_cards) ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {Object.entries(gameState.players).map(([playerId, playerData]) => (
                  <motion.div
                    key={playerId}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-black/30 border border-casino-gold/50 rounded-xl p-4"
                  >
                    <div className="flex justify-between items-center mb-3">
                      <h4 className="font-bold text-casino-gold">{playerId}</h4>
                      <div className={`px-2 py-1 rounded-full text-xs font-semibold ${
                        playerData.status === 'active' ? 'bg-green-500/20 text-green-400' :
                        playerData.status === 'war' ? 'bg-red-500/20 text-red-400' :
                        playerData.status === 'waiting_choice' ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-gray-500/20 text-gray-400'
                      }`}>
                        {playerData.status.replace('_', ' ').toUpperCase()}
                      </div>
                    </div>
                    <div className="flex flex-col items-center mb-3 gap-1">
                      {/* After war round, show both original and war card stacked */}
                      {(!gameState.war_round_active && gameState.war_round?.original_cards?.players?.[playerId]) ? (
                        <div className="flex flex-col items-center gap-1">
                          {renderCard(gameState.war_round.original_cards.players[playerId], 'medium')}
                          {playerData.war_card && (
                            <div className="mt-1">{renderCard(playerData.war_card, 'medium')}</div>
                          )}
                        </div>
                      ) :
                      // Normal round: show only the original card
                      playerData.card ? (
                        renderCard(playerData.card, 'medium')
                      ) : (
                        <div className="w-16 h-22 card-back rounded-lg flex items-center justify-center">
                          <span className="text-white">🎴</span>
                        </div>
                      )}
                    </div>

                    {playerData.war_card && (
                      <div className="text-center mb-3">
                        <div className="text-xs text-red-400 mb-1">War Card</div>
                        <div className="flex justify-center">
                          {renderCard(playerData.war_card, 'small')}
                        </div>
                      </div>
                    )}

                    {gameState.game_mode === 'live' && (gameState.round_active || !playerData.card) && (
                      <div className="mt-3 space-y-2">
                        <input 
                          type="text" 
                          placeholder="Card (e.g., AS, KH)"
                          className="w-full bg-black border border-casino-gold rounded px-2 py-1 text-white text-sm"
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              const card = (e.target as HTMLInputElement).value.toUpperCase()
                              if (card) {
                                sendMessage({ 
                                  action: 'manual_deal_card', 
                                  target: 'player', 
                                  card: card,
                                  player_id: playerId 
                                });
                                (e.target as HTMLInputElement).value = ''
                              }
                            }
                          }}
                        />
                      </div>
                    )}

                    {playerData.result && (
                      <div className={`text-center mt-3 px-2 py-1 rounded-full text-sm font-semibold ${
                        playerData.result === 'win' ? 'bg-green-500/20 text-green-400' :
                        playerData.result === 'lose' ? 'bg-red-500/20 text-red-400' :
                        'bg-yellow-500/20 text-yellow-400'
                      }`}>
                        {playerData.result.toUpperCase()}
                      </div>
                    )}

                    {playerData.status === 'waiting_choice' }
                  </motion.div>
                ))}

                {Object.keys(gameState.players).length === 0 && (
                  <div className="col-span-full text-center py-12 text-gray-400">
                    <div className="text-6xl mb-4">🎲</div>
                    <p className="text-xl">No players at the table</p>
                    <p className="text-sm">Add players to start the game</p>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <style jsx>{`
        .card {
          background: linear-gradient(135deg, #2c4b2e 0%, #1d3323 100%);
          border: 2px solid #d4af37;
          border-radius: 8px;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.8);
        }
        
        .card-back {
          background: linear-gradient(135deg, #0b1e0b 0%, #0a150a 100%);
          border: 2px solid #d4af37;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.8);
        }
        
        .dealer-button {
          @apply bg-gradient-to-r from-yellow-600 to-yellow-700 hover:from-yellow-700 hover:to-yellow-800 text-white px-4 py-2 rounded-lg transition-all duration-200 font-semibold shadow-lg;
        }
        
        .success-button {
          @apply bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-colors font-semibold;
        }
        
        .danger-button {
          @apply bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors;
        }
        
        .animate-spin-slow {
          animation: spin 3s linear infinite;
        }
      `}</style>
      <style jsx global>{`
        body {
          background: radial-gradient(circle,rgb(78, 197, 78),rgb(14, 14, 14));
          color: #fff;
        }
      `}</style>
    </div>
  )
}


