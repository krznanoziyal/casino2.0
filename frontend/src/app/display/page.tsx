// app/display/page.tsx
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
  }
}

interface PlayerData {
  card: string | null
  status: 'active' | 'war' | 'surrender' | 'waiting_choice' | 'finished'
  result: string | null
  war_card: string | null
}

interface GameResult {
  round_number: number
  player_id: string
  player_card: string
  war_card?: string
  dealer_card: string
  result: string
  timestamp: string
  table_number: number
  game_mode: string
}

export default function DisplayPage() {
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
  const [recentResults, setRecentResults] = useState<GameResult[]>([])
  const [roundHistory, setRoundHistory] = useState<any[]>([])
  const [currentTime, setCurrentTime] = useState(new Date())
  const [notifications, setNotifications] = useState<string[]>([]);
  const [playerStatsFromBackend, setPlayerStatsFromBackend] = useState<Record<string, any>>({});
  const [statsLoaded, setStatsLoaded] = useState(false);
  const [sessionStats, setSessionStats] = useState<Record<string, any>>({});

  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    connectWebSocket()
    const timeInterval = setInterval(() => setCurrentTime(new Date()), 1000)
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
      clearInterval(timeInterval)
    }
  }, [])

  const connectWebSocket = () => {
    try {
      wsRef.current = new WebSocket('ws://localhost:6789')
      
      wsRef.current.onopen = () => {
        setConnected(true)
      }
      
      wsRef.current.onclose = () => {
        setConnected(false)
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

  const addNotification = (message: string) => {
    setNotifications(prev => [...prev.slice(-4), message]);
    setTimeout(() => {
      setNotifications(prev => prev.slice(1));
    }, 5000);
  };

  const handleServerMessage = (data: any) => {
    switch (data.action) {
      case 'game_reset':
        setGameState(data.game_state);
        setSessionStats({});
        addNotification('Game has been reset');
        break;
      case 'game_state_update':
        setGameState(data.game_state);
        if (data.stats) setSessionStats(data.stats);
        break;
      case 'round_completed':
        setGameState(prev => ({
          ...prev,
          round_active: false,
          player_results: data.player_results
        }));
        // Add to round history
        const roundData = {
          round_number: data.round_number,
          results: data.player_results,
          timestamp: new Date().toLocaleTimeString(),
          dealer_card: gameState.dealer_card
        };
        setRoundHistory(prev => [roundData, ...prev.slice(0, 9)]);
        // Update sessionStats with backend stats for live UI update
        if (data.stats) setSessionStats(data.stats);
        break;
      case 'all_player_stats':
        if (data.stats) setSessionStats(data.stats);
        break;
      case 'clear_all_stats':
        setSessionStats({});
        break;
      case 'round_dealt':
        setGameState(prev => ({ 
          ...prev, 
          dealer_card: data.dealer_card,
          players: data.players,
          round_number: data.round_number,
          deck_count: data.deck_count,
          player_results: data.player_results
        }))
        break
      case 'war_round_started':
        setGameState(prev => ({ 
          ...prev, 
          war_round_active: true,
          war_round: data.war_round
        }))
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
        break
      }
      case 'player_added':
      case 'player_removed':
        setGameState(prev => ({ 
          ...prev, 
          players: data.players
        }))
        break
      case 'game_mode_changed':
        setGameState(prev => ({ 
          ...prev, 
          game_mode: data.mode
        }))
        break
      case 'bets_changed':
        setGameState(prev => ({ 
          ...prev, 
          min_bet: data.min_bet,
          max_bet: data.max_bet
        }))
        break
      case 'table_changed':
        setGameState(prev => ({ 
          ...prev, 
          table_number: data.table_number
        }))
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
      case 'player_registered':
        if (data.stats) {
          setPlayerStatsFromBackend((prev) => ({ ...prev, ...data.stats }))
          setStatsLoaded(true);
        }
        break
    }
  }

  const renderCard = (card: string | null, size: 'small' | 'medium' | 'large' = 'small') => {
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
        className={`bg-white rounded-lg border-2 border-gray-300 ${sizeClasses[size]} ${isRed ? 'text-red-600' : 'text-black'} flex flex-col justify-between p-2 shadow-lg`}
        initial={{ scale: 0, rotateY: 180 }}
        animate={{ scale: 1, rotateY: 0 }}
        transition={{ duration: 0.5, type: "spring" }}
      >
        <div className="text-left">
          <div className="font-bold leading-none">{rank}</div>
          <div className="text-lg leading-none">{suitSymbol}</div>
        </div>
        <div className="text-center text-2xl">{suitSymbol}</div>
        <div className="text-right rotate-180">
          <div className="font-bold leading-none">{rank}</div>
          <div className="text-lg leading-none">{suitSymbol}</div>
        </div>
      </motion.div>
    )
  }

  const getPlayerStats = () => {
    // Always use sessionStats from backend
    const stats: Record<string, { wins: number; losses: number; ties: number; surrenders: number }> = {};
    Object.keys(gameState.players).forEach(playerId => {
      stats[playerId] = sessionStats[playerId] || { wins: 0, losses: 0, ties: 0, surrenders: 0 };
    });
    return stats
  }

  const getResultColor = (result: string) => {
    switch (result) {
      case 'win': return 'text-green-400 bg-green-500/20 border-green-500'
      case 'lose': return 'text-red-400 bg-red-500/20 border-red-500'
      case 'surrender': return 'text-yellow-400 bg-yellow-500/20 border-yellow-500'
      case 'tie': return 'text-blue-400 bg-blue-500/20 border-blue-500'
      default: return 'text-gray-400 bg-gray-500/20 border-gray-500'
    }
  }

  const playerStats = getPlayerStats()

  // On mount, request all player stats from backend
  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'get_all_player_stats' }))
    }
  }, [connected])

  // Handle clear all stats
  const handleClearAllStats = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'clear_all_stats' }));
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 p-4 overflow-auto">
      {/* Header */}
      <motion.div 
        className="bg-black/70 backdrop-blur-sm border-2 border-purple-500 rounded-xl p-6 mb-6"
        initial={{ opacity: 0, y: -50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-gradient-conic from-purple-500 via-pink-500 to-blue-500 animate-spin border-2 border-purple-500"></div>
            <div>
              <h1 className="text-4xl font-bold text-purple-400">Casino War Display</h1>
              <p className="text-gray-300">Table {gameState.table_number} - Live Game Status</p>
            </div>
          </div>
          <div className="text-right">
            <div className={`px-4 py-2 rounded-full flex items-center gap-2 mb-2 ${connected ? 'bg-green-500/20 border border-green-500 text-green-400' : 'bg-red-500/20 border border-red-500 text-red-400'}`}>
              <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'} animate-pulse`}></div>
              {connected ? 'Live' : 'Offline'}
            </div>
            <div className="text-white text-lg font-mono">
              {currentTime.toLocaleTimeString()}
            </div>
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        {/* Current Game Status */}
        <div className="xl:col-span-2">
          <motion.div 
            className="bg-black/70 backdrop-blur-sm border border-purple-500 rounded-xl p-6"
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <h2 className="text-2xl font-bold text-purple-400 mb-6">Current Game</h2>
            
            {/* Game Info Bar */}
            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="bg-purple-500/20 rounded-lg p-3 text-center">
                <div className="text-purple-400 text-sm">Round</div>
                <div className="text-white text-xl font-bold">{gameState.round_number}</div>
              </div>
              <div className="bg-blue-500/20 rounded-lg p-3 text-center">
                <div className="text-blue-400 text-sm">Deck</div>
                <div className="text-white text-xl font-bold">{gameState.deck_count}</div>
              </div>
              <div className="bg-orange-500/20 rounded-lg p-3 text-center">
                <div className="text-orange-400 text-sm">Mode</div>
                <div className="text-white text-sm font-bold uppercase">{gameState.game_mode}</div>
              </div>
              <div className="bg-green-500/20 rounded-lg p-3 text-center">
                <div className="text-green-400 text-sm">Players</div>
                <div className="text-white text-xl font-bold">{Object.keys(gameState.players).length}</div>
              </div>
            </div>

            {/* Dealer Section */}
            <div className="mb-8">
              <h3 className="text-lg font-bold text-white mb-4 text-center">Dealer</h3>
              <div className="flex justify-center">
                <AnimatePresence>
                  {gameState.dealer_card ? (
                    <motion.div
                      key={gameState.dealer_card}
                      initial={{ scale: 0, rotateY: 180 }}
                      animate={{ scale: 1, rotateY: 0 }}
                      exit={{ scale: 0, rotateY: 180 }}
                      transition={{ duration: 0.6, type: "spring" }}
                    >
                      {renderCard(gameState.dealer_card, 'large')}
                    </motion.div>
                  ) : (
                    <motion.div 
                      className="w-20 h-28 bg-purple-600 rounded-lg border-2 border-purple-400 flex items-center justify-center"
                      animate={{ scale: [1, 1.05, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    >
                      <div className="text-purple-200 text-xs text-center">
                        Waiting for<br />dealer card
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* War Round Display */}
            {gameState.war_round_active && (
              <motion.div 
                className="mb-6 p-4 bg-red-500/20 border border-red-500 rounded-lg"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
              >
                <h3 className="text-red-400 font-bold text-center mb-2">WAR ROUND ACTIVE!</h3>
                <div className="flex justify-center gap-4">
                  {gameState.war_round?.dealer_card && renderCard(gameState.war_round.dealer_card, 'medium')}
                  {Object.entries(gameState.war_round?.players || {}).map(([playerId, card]) => (
                    <div key={playerId} className="text-center">
                      <div className="text-xs text-red-400 mb-1">{playerId}</div>
                      {card ? renderCard(card, 'medium') : (
                        <div className="w-16 h-22 bg-red-600/30 rounded border border-red-500 flex items-center justify-center">
                          <div className="text-red-300 text-xs">War Card</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Players Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {Object.entries(gameState.players).map(([playerId, playerData]) => {
                let resultColor = '';
                let resultText = '';
                switch (playerData.result) {
                  case 'win':
                    resultColor = 'bg-green-500 text-white';
                    resultText = 'WIN';
                    break;
                  case 'lose':
                    resultColor = 'bg-red-600 text-white';
                    resultText = 'LOSS';
                    break;
                  case 'surrender':
                    resultColor = 'bg-white text-black';
                    resultText = 'SURRENDER';
                    break;
                  case 'tie':
                    resultColor = 'bg-yellow-400 text-black';
                    resultText = 'TIE';
                    break;
                  default:
                    resultColor = 'bg-gray-700 text-white';
                    resultText = 'PENDING';
                }
                return (
                  <div key={playerId} className={`rounded-xl p-8 flex flex-col items-center justify-center shadow-lg ${resultColor}`} style={{ minHeight: '120px' }}>
                    <div className="text-2xl font-bold mb-2">Player {playerId}</div>
                    <div className="text-3xl font-extrabold">{resultText}</div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </div>

        {/* Statistics Panel */}
        <div className="xl:col-span-1">
          <motion.div 
            className="bg-black/70 backdrop-blur-sm border border-purple-500 rounded-xl p-6"
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <h2 className="text-xl font-bold text-purple-400 mb-4">Player Statistics</h2>
            <div className="space-y-4">
              {Object.entries(playerStats).map(([playerId, stats]) => (
                <div key={playerId} className="bg-gray-800/50 rounded-lg p-3">
                  <div className="text-white font-bold mb-2">{playerId}</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="text-green-400">Wins: {stats.wins}</div>
                    <div className="text-red-400">Losses: {stats.losses}</div>
                    <div className="text-yellow-400">Surrenders: {stats.surrenders}</div>
                    <div className="text-blue-400">Total: {stats.wins + stats.losses + stats.surrenders}</div>
                  </div>
                  <div className="mt-2 text-xs text-gray-400">
                    Win Rate: {stats.wins + stats.losses + stats.surrenders > 0 ? 
                      Math.round((stats.wins / (stats.wins + stats.losses + stats.surrenders)) * 100) : 0}%
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* Recent Rounds History */}
        {/* <div className="xl:col-span-1">
          <motion.div 
            className="bg-black/70 backdrop-blur-sm border border-purple-500 rounded-xl p-6"
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <h2 className="text-xl font-bold text-purple-400 mb-4">Recent Rounds</h2>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              <AnimatePresence>
                {roundHistory.map((round, index) => (
                  <motion.div 
                    key={round.round_number}
                    className="bg-gray-800/50 rounded-lg p-3"
                    initial={{ opacity: 0, x: 50 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -50 }}
                    transition={{ duration: 0.3, delay: index * 0.1 }}
                  >
                    <div className="flex justify-between items-center mb-2">
                      <div className="text-white font-bold text-sm">Round {round.round_number}</div>
                      <div className="text-gray-400 text-xs">{round.timestamp}</div>
                    </div>
                    {Object.entries(round.results).map(([playerId, result]) => (
                      <div key={playerId} className="flex justify-between items-center text-xs mb-1">
                        <span className="text-gray-300">{playerId}</span>
                        <span className={`px-2 py-1 rounded ${getResultColor(result as string)}`}>
                          {String(result)}
                        </span>
                      </div>
                    ))}
                  </motion.div>
                ))}
              </AnimatePresence>
              {roundHistory.length === 0 && (
                <div className="text-gray-500 text-center py-8">
                  No rounds played yet
                </div>
              )}
            </div>
          </motion.div>
        </div> */}
      </div>

      {/* Bottom Info Bar */}
      <motion.div 
        className="mt-6 bg-black/70 backdrop-blur-sm border border-purple-500 rounded-xl p-4"
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.4 }}
      >
        <div className="flex justify-between items-center text-sm">
          <div className="flex gap-8">
            <div className="text-gray-400">
              Betting Range: <span className="text-green-400">${gameState.min_bet} - ${gameState.max_bet}</span>
            </div>
            <div className="text-gray-400">
              Burned Cards: <span className="text-orange-400">{gameState.burned_cards_count}</span>
            </div>
            <div className="text-gray-400">
              Game Mode: <span className="text-purple-400 uppercase">{gameState.game_mode}</span>
            </div>
          </div>
          <div className="text-gray-400">
            {gameState.round_active ? (
              <span className="text-yellow-400 animate-pulse">Round in Progress...</span>
            ) : (
              <span className="text-gray-500">Waiting for next round</span>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  )
}