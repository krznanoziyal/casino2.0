// app/player/[playerId]/page.tsx
'use client'
import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
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
  }
}

interface PlayerData {
  card: string | null
  status: 'active' | 'war' | 'surrender' | 'waiting_choice' | 'finished'
  result: string | null
  war_card: string | null
}

export default function PlayerPage() {
  const params = useParams()
  const playerId = params.playerId as string
  
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
  const [notifications, setNotifications] = useState<string[]>([])
  const [playerStats, setPlayerStats] = useState({
    wins: 0,
    losses: 0,
    ties: 0,
    surrenders: 0
  })
  
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (playerId) {
      connectWebSocket()
    }
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [playerId])

  const connectWebSocket = () => {
    try {
      wsRef.current = new WebSocket('ws://localhost:6789')
      
      wsRef.current.onopen = () => {
        setConnected(true)
        sendMessage({ action: 'register_player', player_id: playerId })
        addNotification('Connected to game')
      }
      
      wsRef.current.onclose = () => {
        setConnected(false)
        addNotification('Disconnected from server')
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
      case 'player_registered':
        addNotification(`Registered as ${data.player_id}`)
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
        
        // Check if this player has a tie
        if (data.tie_players?.includes(playerId)) {
          addNotification('TIE! Choose WAR or SURRENDER')
        }
        break
      case 'player_choice_made':
        setGameState(prev => ({ 
          ...prev, 
          players: data.players,
          player_results: data.player_results
        }))
        if (data.player_id === playerId) {
          addNotification(`Choice made: ${data.choice.toUpperCase()}`)
        }
        break
      case 'war_round_started':
        setGameState(prev => ({ 
          ...prev, 
          war_round_active: true,
          war_round: data.war_round
        }))
        if (data.players.includes(playerId)) {
          addNotification('WAR ROUND STARTED! ⚔️')
        }
        break
      case 'war_round_evaluated': {
        setGameState(prev => {
          const prevOriginalCards = (prev.war_round && 'original_cards' in prev.war_round) ? prev.war_round.original_cards : undefined;
          return {
            ...prev, 
            war_round_active: false,
            war_round: {
              dealer_card: data.dealer_card, // Show the dealer's war card
              players: {
                ...((prev.war_round && prev.war_round.players) || {}),
                ...Object.fromEntries(Object.entries(data.players || {}).map(([pid, pdata]) => [pid, (pdata as PlayerData).war_card || null]))
              },
              ...(prevOriginalCards ? { original_cards: prevOriginalCards } : {})
            },
            players: { ...prev.players, ...data.players },
            player_results: data.player_results
          }
        })
        addNotification('War round completed')
        break
      }
      case 'round_completed':
        setGameState(prev => ({ 
          ...prev, 
          round_active: false,
          player_results: data.player_results
        }))
        
        // Update player stats
        const result = data.player_results[playerId]
        if (result) {
          setPlayerStats(prev => ({
            ...prev,
            [result === 'win' ? 'wins' : 
             result === 'lose' ? 'losses' : 
             result === 'surrender' ? 'surrenders' : 'ties']: prev[
              result === 'win' ? 'wins' : 
              result === 'lose' ? 'losses' : 
              result === 'surrender' ? 'surrenders' : 'ties'
            ] + 1
          }))
        }
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
          dealer_card: data.card,
          deck_count: typeof data.game_state?.deck_count === 'number' ? data.game_state.deck_count : (typeof data.deck_count === 'number' ? data.deck_count : prev.deck_count)
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
          },
          deck_count: typeof data.game_state?.deck_count === 'number' ? data.game_state.deck_count : (typeof data.deck_count === 'number' ? data.deck_count : prev.deck_count)
        }))
        addNotification(`Card manually assigned to player ${data.player_id}`)
        break
      case 'war_card_assigned':
        setGameState(prev => ({
          ...prev,
          war_round: {
            dealer_card: data.target === 'dealer'
              ? data.card
              : prev.war_round?.dealer_card ?? null,
            players: {
              ...((prev.war_round && prev.war_round.players) || {}),
              ...(data.target === 'player' && data.player_id
                ? { [data.player_id]: data.card }
                : {})
            }
          }
        }));
        addNotification(
          `War card ${data.card} assigned to ${data.target === 'dealer' ? 'Dealer' : 'Player ' + data.player_id}`
        );
        break;
        
      case 'cards_undone':
        setGameState(prev => ({
          ...prev,
          deck_count: data.deck_count,
          dealer_card: data.dealer_card,
          players: data.players
        }))
        if (data.message) addNotification(data.message)
        break
      case 'bets_changed':
        setGameState(prev => ({ ...prev, min_bet: data.min_bet, max_bet: data.max_bet }));
        addNotification(`Betting range updated: $${data.min_bet} - $${data.max_bet}`);
        break;
      case 'table_changed':
        setGameState(prev => ({ ...prev, table_number: data.table_number }));
        addNotification(`Table number updated: ${data.table_number}`);
        break;
      case 'player_added':
        setGameState(prev => ({ ...prev, players: data.players }));
        if (data.player_id === playerId) {
          addNotification('You have been added to the table!');
        }
        break;
      case 'player_removed':
        setGameState(prev => ({ ...prev, players: data.players, player_results: data.player_results }));
        if (data.player_id === playerId) {
          addNotification('You have been removed from the table.');
        }
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
      small: 'w-16 h-22 text-sm',
      medium: 'w-20 h-28 text-base',
      large: 'w-24 h-36 text-lg'
    }
    
    return (
      <motion.div
        initial={{ rotateY: 180, scale: 0.8 }}
        animate={{ rotateY: 0, scale: 1 }}
        transition={{ duration: 0.6 }}
        className={`bg-white rounded-lg shadow-lg border-2 border-gray-300 ${sizeClasses[size]} ${isRed ? 'text-red-600' : 'text-black'} flex flex-col justify-between p-2`}
      >
        <div className="text-left">
          <div className="font-bold">{rank}</div>
          <div className="text-2xl leading-none">{suitSymbol}</div>
        </div>
        <div className="text-center text-4xl">{suitSymbol}</div>
        <div className="text-right rotate-180">
          <div className="font-bold">{rank}</div>
          <div className="text-2xl leading-none">{suitSymbol}</div>
        </div>
      </motion.div>
    )
  }

  const renderCardBack = (size: 'small' | 'medium' | 'large' = 'medium') => {
    const sizeClasses = {
      small: 'w-16 h-22 text-sm',
      medium: 'w-20 h-28 text-base',
      large: 'w-24 h-36 text-lg'
    }
    
    return (
      <div className={`bg-blue-900 rounded-lg flex items-center justify-center border-2 border-blue-700 ${sizeClasses[size]}`}>
        <span className="text-white text-3xl">🎴</span>
      </div>
    )
  }

  const playerData = gameState.players[playerId]
  const isInWar = gameState.war_round_active && gameState.war_round?.players[playerId] !== undefined
  const hasWarData = gameState.war_round && (gameState.war_round.dealer_card || gameState.war_round.players[playerId])

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-green-900 to-gray-900 p-4">
      {/* Header */}
      <div className="bg-black/60 backdrop-blur-sm border-2 border-yellow-500 rounded-xl p-6 mb-6">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-gradient-conic from-green-500 via-yellow-500 to-red-500 animate-spin border-2 border-yellow-500"></div>
            <div>
              <h1 className="text-3xl font-bold text-yellow-500">Player: {playerId}</h1>
              <p className="text-gray-300">Table {gameState.table_number} - Round {gameState.round_number}</p>
            </div>
          </div>
          <div className={`px-4 py-2 rounded-full flex items-center gap-2 ${connected ? 'bg-green-500/20 border border-green-500 text-green-400' : 'bg-red-500/20 border border-red-500 text-red-400'}`}>
            <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'} animate-pulse`}></div>
            {connected ? 'Connected' : 'Disconnected'}
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
            className="fixed top-20 right-6 bg-yellow-500 text-black px-4 py-2 rounded-lg shadow-lg z-50 mb-2"
            style={{ top: `${80 + index * 60}px` }}
          >
            {notification}
          </motion.div>
        ))}
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Player Stats */}
        <div className="bg-black/60 backdrop-blur-sm border border-yellow-500 rounded-xl p-6">
          <h2 className="text-xl font-bold text-yellow-500 mb-4">Your Stats</h2>
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 bg-green-500/20 rounded-lg">
              <span className="text-green-400 font-semibold">Wins</span>
              <span className="text-green-400 text-xl font-bold">{playerStats.wins}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-red-500/20 rounded-lg">
              <span className="text-red-400 font-semibold">Losses</span>
              <span className="text-red-400 text-xl font-bold">{playerStats.losses}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-yellow-500/20 rounded-lg">
              <span className="text-yellow-400 font-semibold">Ties</span>
              <span className="text-yellow-400 text-xl font-bold">{playerStats.ties}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-500/20 rounded-lg">
              <span className="text-gray-400 font-semibold">Surrenders</span>
              <span className="text-gray-400 text-xl font-bold">{playerStats.surrenders}</span>
            </div>
          </div>
          
          <div className="mt-6 p-4 bg-black/30 rounded-lg">
            <h3 className="text-yellow-500 font-semibold mb-2">Game Info</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Mode:</span>
                <span className="text-white uppercase">{gameState.game_mode}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Betting:</span>
                <span className="text-white">${gameState.min_bet} - ${gameState.max_bet}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Players:</span>
                <span className="text-white">{Object.keys(gameState.players).length}/6</span>
              </div>
            </div>
          </div>
        </div>

        {/* Game Area */}
        <div className="lg:col-span-2">
          <div className="bg-black/60 backdrop-blur-sm border border-yellow-500 rounded-xl p-6">
            {/* Dealer Section */}
            <div className="text-center mb-8">
              <h3 className="text-xl font-bold text-yellow-500 mb-4">Dealer</h3>
              <div className="flex flex-col items-center gap-4">
                {/* Original Dealer Card */}
                <div className="flex flex-col items-center">
                  <span className="text-gray-400 text-sm mb-2">Original Card</span>
                  {gameState.dealer_card ? (
                    renderCard(gameState.dealer_card, 'large')
                  ) : (
                    renderCardBack('large')
                  )}
                </div>
                
                {/* Dealer War Card - Only show if war data exists */}
                {hasWarData && (
                  <div className="flex flex-col items-center">
                    <span className="text-red-400 text-sm mb-2">War Card</span>
                    {gameState.war_round?.dealer_card ? (
                      renderCard(gameState.war_round.dealer_card, 'large')
                    ) : (
                      renderCardBack('large')
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* War Round Active Section */}
            {gameState.war_round_active && !gameState.war_round?.dealer_card && !gameState.war_round?.players[playerId] && (
              <div className="bg-red-900/30 border-2 border-red-500 rounded-xl p-6 mb-8">
                <h3 className="text-xl font-bold text-red-400 mb-4 text-center">⚔️ WAR ROUND ACTIVE ⚔️</h3>
                <p className="text-center text-red-300">War cards are being dealt...</p>
              </div>
            )}

            {/* Player Section */}
            <div className="text-center">
              <h3 className="text-xl font-bold text-yellow-500 mb-4">Your Cards</h3>
              {playerData ? (
                <div className="space-y-6">
                  <div className="flex flex-col items-center gap-4">
                    {/* Original Player Card */}
                    <div className="flex flex-col items-center">
                      <span className="text-gray-400 text-sm mb-2">Original Card</span>
                      {playerData.card ? (
                        renderCard(playerData.card, 'large')
                      ) : (
                        renderCardBack('large')
                      )}
                    </div>
                    
                    {/* Player War Card - Show if player has war card OR war data exists for this player */}
                    {(playerData.war_card || (hasWarData && gameState.war_round?.players[playerId])) && (
                      <div className="flex flex-col items-center">
                        <span className="text-red-400 text-sm mb-2">War Card</span>
                        {playerData.war_card ? (
                          renderCard(playerData.war_card, 'large')
                        ) : gameState.war_round?.players[playerId] ? (
                          renderCard(gameState.war_round.players[playerId], 'large')
                        ) : (
                          renderCardBack('large')
                        )}
                      </div>
                    )}
                  </div>
                  
                  {/* Status */}
                  <div className={`inline-block px-4 py-2 rounded-full text-lg font-bold ${
                    playerData.status === 'active' ? 'bg-green-500/20 text-green-400' :
                    playerData.status === 'war' ? 'bg-red-500/20 text-red-400' :
                    playerData.status === 'waiting_choice' ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-gray-500/20 text-gray-400'
                  }`}>
                    {playerData.status.replace('_', ' ').toUpperCase()}
                  </div>

                  {/* Result */}
                  {playerData.result && (
                    <div className={`text-3xl font-bold ${
                      playerData.result === 'win' ? 'text-green-400' :
                      playerData.result === 'lose' ? 'text-red-400' :
                      'text-yellow-400'
                    }`}>
                      {playerData.result === 'win' ? '🎉 YOU WIN!' :
                       playerData.result === 'lose' ? '😞 YOU LOSE' :
                       playerData.result === 'surrender' ? '🏳️ SURRENDERED' :
                       '🤝 TIE!'}
                    </div>
                  )}

                  {/* Choice Buttons */}
                  {playerData.status === 'waiting_choice' && (
                    <div className="flex gap-4 justify-center">
                      <motion.button 
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => sendMessage({ action: 'player_choice', player_id: playerId, choice: 'war' })}
                        className="bg-red-600 hover:bg-red-700 text-white px-8 py-4 rounded-xl text-xl font-bold transition-colors shadow-lg"
                      >
                        ⚔️ WAR!
                      </motion.button>
                      <motion.button 
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => sendMessage({ action: 'player_choice', player_id: playerId, choice: 'surrender' })}
                        className="bg-gray-600 hover:bg-gray-700 text-white px-8 py-4 rounded-xl text-xl font-bold transition-colors shadow-lg"
                      >
                        🏳️ SURRENDER
                      </motion.button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center text-gray-400">
                  <p className="text-xl mb-4">You are not currently in the game</p>
                  <p className="text-sm">Ask the dealer to add you to the game</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}