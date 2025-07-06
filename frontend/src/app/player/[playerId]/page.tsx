// app/player/[playerId]/page.tsx
'use client'
import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import Image from 'next/image'

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

export default function PlayerPage () {
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
  // Use sessionStats from backend, not local increment
  const [sessionStats, setSessionStats] = useState<
    Record<
      string,
      { wins: number; losses: number; ties: number; surrenders: number }
    >
  >({})

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

      wsRef.current.onmessage = event => {
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
    setNotifications(prev => {
      if (prev[prev.length - 1] === message) return prev // Prevent duplicate
      return [...prev.slice(-4), message]
    })
    setTimeout(() => {
      setNotifications(prev => prev.slice(1))
    }, 5000)
  }

  const handleServerMessage = (data: any) => {
    switch (data.action) {
      case 'game_state_update':
        setGameState(data.game_state)
        if (data.stats) setSessionStats(data.stats) // Always overwrite
        break
      case 'player_registered':
        addNotification(`Registered as ${data.player_id}`)
        // Do NOT update sessionStats here; wait for game_state_update or round_completed
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
          const prevOriginalCards =
            prev.war_round && 'original_cards' in prev.war_round
              ? prev.war_round.original_cards
              : undefined
          return {
            ...prev,
            war_round_active: false,
            war_round: {
              dealer_card: data.dealer_card, // Show the dealer's war card
              players: {
                ...((prev.war_round && prev.war_round.players) || {}),
                ...Object.fromEntries(
                  Object.entries(data.players || {}).map(([pid, pdata]) => [
                    pid,
                    (pdata as PlayerData).war_card || null
                  ])
                )
              },
              ...(prevOriginalCards
                ? { original_cards: prevOriginalCards }
                : {})
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
        if (data.stats) setSessionStats(data.stats) // Always overwrite
        break
      case 'all_player_stats':
        if (data.stats) setSessionStats(data.stats) // Always overwrite
        break
      case 'clear_all_stats':
        setSessionStats({}) // Clear immediately, backend will send new stats
        break
      case 'error':
        addNotification(`Error: ${data.message}`)
        break
      case 'game_reset':
        setGameState(data.game_state)
        if (data.stats) setSessionStats(data.stats)
        addNotification('Game has been reset')
        break
      case 'dealer_card_set':
        setGameState(prev => ({
          ...prev,
          dealer_card: data.card,
          deck_count:
            typeof data.game_state?.deck_count === 'number'
              ? data.game_state.deck_count
              : typeof data.deck_count === 'number'
              ? data.deck_count
              : prev.deck_count
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
          deck_count:
            typeof data.game_state?.deck_count === 'number'
              ? data.game_state.deck_count
              : typeof data.deck_count === 'number'
              ? data.deck_count
              : prev.deck_count
        }))
        addNotification(`Card manually assigned to player ${data.player_id}`)
        break
      case 'war_card_assigned':
        setGameState(prev => ({
          ...prev,
          war_round: {
            dealer_card:
              data.target === 'dealer'
                ? data.card
                : prev.war_round?.dealer_card ?? null,
            players: {
              ...((prev.war_round && prev.war_round.players) || {}),
              ...(data.target === 'player' && data.player_id
                ? { [data.player_id]: data.card }
                : {})
            }
          }
        }))
        addNotification(
          `War card ${data.card} assigned to ${
            data.target === 'dealer' ? 'Dealer' : 'Player ' + data.player_id
          }`
        )
        break
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
        setGameState(prev => ({
          ...prev,
          min_bet: data.min_bet,
          max_bet: data.max_bet
        }))
        addNotification(
          `Betting range updated: $${data.min_bet} - $${data.max_bet}`
        )
        break
      case 'table_changed':
        setGameState(prev => ({ ...prev, table_number: data.table_number }))
        addNotification(`Table number updated: ${data.table_number}`)
        break
      case 'player_added':
        setGameState(prev => ({ ...prev, players: data.players }))
        if (data.player_id === playerId) {
          addNotification('You have been added to the table!')
        }
        break
      case 'player_removed':
        setGameState(prev => ({
          ...prev,
          players: data.players,
          player_results: data.player_results
        }))
        if (data.player_id === playerId) {
          addNotification('You have been removed from the table.')
        }
        break
      case 'manual_result_assigned': {
        // If this is for this player, update result and show popup
        if (data.player_id === playerId) {
          setGameState(prev => ({
            ...prev,
            players: {
              ...prev.players,
              [playerId]: {
                ...prev.players[playerId],
                result: data.result,
                status: 'finished'
              }
            },
            player_results: {
              ...prev.player_results,
              [playerId]: data.result
            }
          }))
          addNotification(data.result === 'win' ? 'You WIN!' : 'You LOSE!')
        } else {
          // Update other players' results for display
          setGameState(prev => ({
            ...prev,
            players: {
              ...prev.players,
              [data.player_id]: {
                ...prev.players[data.player_id],
                result: data.result,
                status: 'finished'
              }
            },
            player_results: {
              ...prev.player_results,
              [data.player_id]: data.result
            }
          }))
        }
        break
      }
      default:
        if (data.message) {
          addNotification(data.message)
        }
    }
  }

  // On mount, request all player stats from backend (optional, for instant sync)
  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'get_all_player_stats' }))
    }
  }, [connected])

  // Handle clear all stats
  const handleClearAllStats = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'clear_all_stats' }))
    }
  }

  const renderCard = (
    card: string | null,
    size: 'small' | 'medium' | 'large' = 'medium'
  ) => {
    if (!card) return null

    const rank = card[0]
    const suit = card[1]

    console.log(`Rendering card: ${rank}${suit}`)
    const suitSymbol = { S: '♠', H: '♥', D: '♦', C: '♣' }[suit] || suit
    const isRed = suit === 'H' || suit === 'D'

    const sizeClasses = {
      small: 'w-12 h-16 text-xs',
      medium: 'w-16 h-20 text-sm',
      large: 'w-20 h-28 text-base'
    }

    return (
      <motion.div
        initial={{ rotateY: 180, scale: 0.8 }}
        animate={{ rotateY: 0, scale: 1 }}
        transition={{ duration: 0.6 }}
        className={`${sizeClasses[size]} relative rounded-lg shadow-lg overflow-hidden`}
      >
        
        <Image
          src={`/cards/${rank}${suit}.png`}
          alt={`${rank} of ${suit}`}
          fill
          className='object-cover rounded-lg'
          sizes='(max-width: 640px) 64px, (max-width: 768px) 80px, 96px'
        />
      </motion.div>
    )
  }

  const renderCardBack = (size: 'small' | 'medium' | 'large' = 'medium') => {
    const sizeClasses = {
      small: 'w-12 h-16 text-xs',
      medium: 'w-16 h-20 text-sm',
      large: 'w-20 h-28 text-base'
    }

    return (
      <div className={`${sizeClasses[size]} relative rounded-lg shadow-lg overflow-hidden`}>
      <Image
        src='/cards/BB.png'
        alt='Card Back'
        fill
        className='object-cover rounded-lg'
        sizes='(max-width: 640px) 64px, (max-width: 768px) 80px, 96px'
      />
    </div>
    )
  }

  const playerData = gameState.players[playerId]
  const isInWar =
    gameState.war_round_active &&
    gameState.war_round?.players[playerId] !== undefined
  const hasWarData =
    gameState.war_round &&
    (gameState.war_round.dealer_card || gameState.war_round.players[playerId])

  return (
    <div className='min-h-screen bg-[#450a03]'>
      {/* Header with wood background */}
      <nav className='relative h-[15vh] w-full overflow-hidden mb-6'>
        <img
          src='/assets/wood.png'
          alt='Wood Background'
          className='absolute inset-0 object-cover w-full h-full'
        />
        <div className='relative h-full'>
          <div className='flex items-center justify-between -mt-2 xs:-mt-3 sm:-mt-4 px-2 xs:px-4 sm:px-6 md:px-8'>
            {/* Left Side - Casino Wars Logo */}
            <div className='w-16 h-16 xs:w-20 xs:h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 lg:w-32 lg:h-32 relative flex flex-col items-center justify-center overflow-hidden'>
              <div className='relative w-12 h-12 xs:w-14 xs:h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 lg:w-24 lg:h-24 xl:w-28 xl:h-28'>
                <Image
                  src='/assets/logo.png'
                  alt='Casino Wars Logo'
                  fill
                  className='object-contain'
                  sizes='(max-width: 375px) 48px, (max-width: 640px) 56px, (max-width: 768px) 64px, (max-width: 1024px) 80px, (max-width: 1280px) 96px, 112px'
                  priority
                />
              </div>
              <span className='text-yellow-300 text-[8px] xs:text-[9px] sm:text-xs md:text-sm lg:text-base -mt-1 xs:-mt-2 sm:-mt-3 md:-mt-4'>
                Table: {gameState.table_number}
              </span>
            </div>

            {/* Center - Ocean 7 Logo */}
            <div className='flex items-center justify-center'>
              <div className='relative w-20 h-12 xs:w-24 xs:h-14 sm:w-32 sm:h-16 md:w-40 md:h-20 lg:w-48 lg:h-24 xl:w-48 xl:h-24'>
                <Image
                  src='/assets/ocean7-logo.png'
                  alt='Ocean 7 Casino'
                  fill
                  className='object-contain'
                  sizes='(max-width: 375px) 80px, (max-width: 640px) 96px, (max-width: 768px) 128px, (max-width: 1024px) 160px, (max-width: 1280px) 192px, 224px'
                  priority
                />
              </div>
            </div>

            {/* Right Side - Betting Info */}
            <div className='w-16 h-16 xs:w-20 xs:h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 lg:w-32 lg:h-32 relative flex flex-col items-center justify-center overflow-hidden'>
              <div className='text-center'>
                <div className='text-[#DEBE83] font-bold text-[8px] xs:text-[9px] sm:text-xs md:text-sm lg:text-base font-[questrial] mb-0.5'>
                  Bets
                </div>
                <div className='text-yellow-300 text-[7px] xs:text-[8px] sm:text-[9px] md:text-xs lg:text-sm'>
                  Max: {gameState.max_bet.toLocaleString()}
                </div>
                <div className='text-yellow-300 text-[7px] xs:text-[8px] sm:text-[9px] md:text-xs lg:text-sm'>
                  Min: {gameState.min_bet.toLocaleString()}
                </div>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Notifications */}
      <AnimatePresence>
        {notifications.map((notification, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, x: 300 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -300 }}
            className='fixed top-20 right-6 bg-yellow-500 text-black px-4 py-2 rounded-lg shadow-lg z-50 mb-2'
            style={{ top: `${80 + index * 60}px` }}
          >
            {notification}
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Game Area */}
      <div className='mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8 md:py-10'>
        <div className='bg-[#911606] border-4 border-[#d4af37] p-4 sm:p-6 md:p-8 w-full grow flex flex-col rounded-lg shadow-xl'>
          {/* Player Number and Status */}
          <div className='text-center mb-6 sm:mb-8'>
            <h2 className='text-3xl sm:text-4xl font-semibold text-[#d4af37] font-[questrial] tracking-widest mb-4'>
              PLAYER {playerId}
            </h2>
            {playerData && (
              <div className='flex justify-center'>
                <div
                  className={`inline-block px-4 sm:px-6 py-1.5 sm:py-2 ${
                    playerData.status === 'active'
                      ? 'bg-[#7a1105]'
                      : playerData.status === 'war'
                      ? 'bg-[#8B0000]'
                      : playerData.status === 'waiting_choice'
                      ? 'bg-[#8B0000]'
                      : 'bg-[#7a1105]'
                  } text-white font-semibold rounded shadow-md`}
                >
                  {playerData.status === 'active'
                    ? 'Active'
                    : playerData.status === 'war'
                    ? 'War'
                    : playerData.status === 'waiting_choice'
                    ? 'Choose'
                    : playerData.status === 'surrender'
                    ? 'Surrender'
                    : 'Finished'}
                </div>
              </div>
            )}
          </div>

          {/* Dealer Section */}
          <div className='bg-[#a42210] border-2 border-[#d4af37] p-4 sm:p-6 rounded-xl mb-6 sm:mb-8 shadow-md'>
            <h3 className='text-xl font-medium font-[questrial] tracking-widest text-white mb-4'>
              Dealer's Hand
            </h3>
            <div className='flex justify-center items-center gap-4 min-h-[120px]'>
              {/* Original Dealer Card */}
              <div className='flex flex-col items-center'>
                {gameState.dealer_card
                  ? renderCard(gameState.dealer_card, 'large')
                  : renderCardBack('large')}
              </div>

              {/* Dealer War Card - Only show if war data exists */}
              {hasWarData && (
                <div className='flex flex-col items-center'>
                  {gameState.war_round?.dealer_card
                    ? renderCard(gameState.war_round.dealer_card, 'large')
                    : renderCardBack('large')}
                </div>
              )}
            </div>
          </div>

          {/* War Round Active Section */}
          {gameState.war_round_active &&
            !gameState.war_round?.dealer_card &&
            !gameState.war_round?.players[playerId] && (
              <div className='bg-red-900/30 border-2 border-red-500 rounded-xl p-4 sm:p-6 mb-6 sm:mb-8 shadow-md'>
                <h3 className='text-xl font-bold text-red-400 mb-4 text-center'>
                  ⚔️ WAR ROUND ACTIVE ⚔️
                </h3>
                <p className='text-center text-red-300'>
                  War cards are being dealt...
                </p>
              </div>
            )}

          {/* Player Section */}
          <div className='text-center'>
            <div className='bg-[#a42210] p-4 sm:p-6 rounded-xl mb-6 sm:mb-8 shadow-md'>
              <h3 className='text-xl font-medium font-[questrial] tracking-widest text-white text-left mb-4'>
                Your Hand
              </h3>
              {playerData ? (
                <div className='flex justify-center items-center gap-4'>
                  {/* Original Player Card */}
                  <div className='flex flex-col items-center'>
                    {playerData.card
                      ? renderCard(playerData.card, 'large')
                      : renderCardBack('large')}
                  </div>

                  {/* Player War Card - Show if player has war card OR war data exists for this player */}
                  {(playerData.war_card ||
                    (hasWarData && gameState.war_round?.players[playerId])) && (
                    <div className='flex flex-col items-center'>
                      {playerData.war_card
                        ? renderCard(playerData.war_card, 'large')
                        : gameState.war_round?.players[playerId]
                        ? renderCard(
                            gameState.war_round.players[playerId],
                            'large'
                          )
                        : renderCardBack('large')}
                    </div>
                  )}
                </div>
              ) : (
                <div className='text-center text-white py-4'>
                  <p>You are not currently in the game</p>
                </div>
              )}
            </div>

            {/* Player Result and Choice Buttons */}
            {playerData && (
              <div className='space-y-4'>
                {/* Result */}
                {playerData.result && (
                  <div
                    className={`text-2xl sm:text-3xl font-bold p-3 rounded-lg shadow-lg ${
                      playerData.result === 'win'
                        ? 'bg-gradient-to-r from-green-700/80 to-green-500/80 text-white border border-green-400'
                        : playerData.result === 'lose'
                        ? 'bg-gradient-to-r from-red-700/80 to-red-500/80 text-white border border-red-400'
                        : playerData.result === 'surrender'
                        ? 'bg-gradient-to-r from-gray-700/80 to-gray-500/80 text-gray-200 border border-gray-400'
                        : 'bg-gradient-to-r from-yellow-600/80 to-amber-500/80 text-white border border-yellow-400'
                    }`}
                  >
                    {playerData.result === 'win'
                      ? '🎉 YOU WIN!'
                      : playerData.result === 'lose'
                      ? '😞 YOU LOSE'
                      : playerData.result === 'surrender'
                      ? '🏳️ SURRENDERED'
                      : '🤝 TIE!'}
                  </div>
                )}

                {/* Choice Buttons */}
                {playerData.status === 'waiting_choice' && (
                  <div className='flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center mt-4 sm:mt-6'>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() =>
                        sendMessage({
                          action: 'player_choice',
                          player_id: playerId,
                          choice: 'war'
                        })
                      }
                      className='bg-[#d4af37] hover:bg-[#c9a633] text-black px-6 sm:px-8 py-3 rounded-lg text-lg sm:text-xl font-bold transition-colors shadow-lg w-full sm:w-auto'
                    >
                      War
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() =>
                        sendMessage({
                          action: 'player_choice',
                          player_id: playerId,
                          choice: 'surrender'
                        })
                      }
                      className='bg-[#8B0000] hover:bg-[#7a0000] text-white px-6 sm:px-8 py-3 rounded-lg text-lg sm:text-xl font-bold transition-colors shadow-lg w-full sm:w-auto'
                    >
                      Surrender
                    </motion.button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        .wood-header {
          height: 60px;
          position: relative;
        }

        @media (min-width: 375px) {
          .wood-header {
            height: 70px;
          }
        }

        @media (min-width: 480px) {
          .wood-header {
            height: 80px;
          }
        }

        @media (min-width: 640px) {
          .wood-header {
            height: 90px;
          }
        }

        @media (min-width: 768px) {
          .wood-header {
            height: 100px;
          }
        }

        @media (min-width: 1024px) {
          .wood-header {
            height: 110px;
          }
        }

        @media (min-width: 1280px) {
          .wood-header {
            height: 130px;
          }
        }

        /* Specific optimization for 800x1112 dimension */
        @media (min-width: 800px) and (max-width: 850px) {
          .wood-header {
            height: 105px;
          }
        }

        .logo-container {
          filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.6));
          transition: all 0.2s ease;
        }

        @media (max-width: 640px) {
          .logo-container img {
            max-width: 100%;
          }
        }

        .table-number {
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
        }

        /* Ensure content stays within bounds */
        .wood-header .flex {
          height: 100%;
          overflow: hidden;
        }

        /* Custom breakpoint for xs (375px) */
        @media (min-width: 375px) {
          .xs\\:w-\\[160px\\] {
            width: 160px;
          }
          .xs\\:w-\\[55\\%\\] {
            width: 55%;
          }
          .xs\\:max-h-\\[55\\%\\] {
            max-height: 55%;
          }
          .xs\\:p-1\\.5 {
            padding: 0.375rem;
          }
          .xs\\:mt-1 {
            margin-top: 0.25rem;
          }
          .xs\\:text-\\[9px\\] {
            font-size: 9px;
          }
          .xs\\:text-xs {
            font-size: 0.75rem;
          }
          .xs\\:text-\\[8px\\] {
            font-size: 8px;
          }
          .xs\\:mb-1 {
            margin-bottom: 0.25rem;
          }
        }
      `}</style>
    </div>
  )
}
