'use client'
import { useState, useEffect, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FaBars, FaTimes, FaMoneyBillWave } from 'react-icons/fa'
import Image from 'next/image'

// Use FaBars, FaTimes, and FaMoneyBillWave as JSX components with .default if needed
// @ts-ignore
const FaBarsIcon = (FaBars as any).default || FaBars
// @ts-ignore
const FaTimesIcon = (FaTimes as any).default || FaTimes
// @ts-ignore
const FaMoneyIcon = (FaMoneyBillWave as any).default || FaMoneyBillWave

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

export default function DealerPage () {
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
  const [warCardTarget, setWarCardTarget] = useState<'dealer' | 'player'>(
    'dealer'
  )
  const [warCardValue, setWarCardValue] = useState('')
  const [warPlayerId, setWarPlayerId] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [manualCardTarget, setManualCardTarget] = useState('')
  const [manualCardSpecific, setManualCardSpecific] = useState('')
  const [betMenuOpen, setBetMenuOpen] = useState(false)
  const [pendingMinBet, setPendingMinBet] = useState(gameState.min_bet)
  const [pendingMaxBet, setPendingMaxBet] = useState(gameState.max_bet)
  const [pendingTableNumber, setPendingTableNumber] = useState(
    gameState.table_number
  )

  const wsRef = useRef<WebSocket | null>(null)
  const prevPlayerStatusesRef = useRef<Record<string, string>>({})

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

  // Deduplicated notification function
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
        break
      case 'deck_shuffled':
        setGameState(prev => ({
          ...prev,
          deck_count: data.deck_count,
          burned_cards_count: data.burned_cards_count
        }))
        addNotification(`Deck shuffled - ${data.deck_count} cards remaining`)
        break
      case 'card_burned':
        setGameState(prev => ({
          ...prev,
          deck_count: data.deck_count,
          burned_cards_count: data.burned_cards_count
        }))
        addNotification(
          data.message ||
            `Card ${data.burned_card} burned - ${data.deck_count} cards remaining`
        )
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
          addNotification(
            `Tie with players: ${data.tie_players.join(
              ', '
            )} - Choose War or Surrender`
          )
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
                ((data.players || []) as string[]).map((pid: string) => [
                  pid,
                  prev.players[pid]?.card || null
                ])
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
          // Always use the complete war_round from backend to ensure live state sync
          war_round: data.war_round || {
            dealer_card:
              data.target === 'dealer'
                ? data.card
                : prev.war_round?.dealer_card ?? null,
            players: {
              ...prev.war_round?.players,
              ...(data.target === 'player' && data.player_id
                ? { [data.player_id]: data.card }
                : {})
            },
            ...(prev.war_round?.original_cards
              ? { original_cards: prev.war_round.original_cards }
              : {})
          },
          deck_count:
            typeof data.deck_count === 'number'
              ? data.deck_count
              : prev.deck_count
        }))
        addNotification(
          `War card ${data.card} assigned to ${
            data.target === 'dealer' ? 'Dealer' : 'Player ' + data.player_id
          }`
        )
        break
      case 'cards_undone':
        setGameState(prev => {
          setWarCardValue('')
          setWarPlayerId('')
          // Debug: log war_round received from backend
          console.log(
            'Received war_round from backend after undo:',
            data.war_round
          )
          const newState = {
            ...prev,
            deck_count:
              typeof data.deck_count === 'number'
                ? data.deck_count
                : prev.deck_count,
            war_round: data.hasOwnProperty('war_round')
              ? data.war_round
              : prev.war_round,
            players: data.hasOwnProperty('players')
              ? data.players
              : prev.players,
            dealer_card: data.hasOwnProperty('dealer_card')
              ? data.dealer_card
              : prev.dealer_card
          }
          // Debug: log new war_round in state
          console.log(
            'Updated war_round in state after undo:',
            newState.war_round
          )
          return newState
        })
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
      default:
        if (data.message) {
          addNotification(data.message)
        }
    }
  }

  const renderCard = (
    card: string | null,
    size: 'small' | 'medium' | 'large' = 'medium'
  ) => {
    if (!card) return null

    const rank = card[0]
    const suit = card[1]
    const suitSymbol = { S: '♠', H: '♥', D: '♦', C: '♣' }[suit] || suit
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
        className={`card ${sizeClasses[size]} ${
          isRed ? 'text-red-600' : 'text-black'
        } flex flex-col justify-between p-1`}
      >
        <div className='text-left'>
          <div className='font-bold'>{rank}</div>
          <div className='text-lg leading-none'>{suitSymbol}</div>
        </div>
        <div className='text-center text-2xl'>{suitSymbol}</div>
        <div className='text-right rotate-180'>
          <div className='font-bold'>{rank}</div>
          <div className='text-lg leading-none'>{suitSymbol}</div>
        </div>
      </motion.div>
    )
  }

  //THIS CODE SNIPPET CHANGE MADE SURE WAR PLAYERS ARE LISTED IN THE DROP DOWN
  const warPlayers =
    gameState.war_round && gameState.war_round.players
      ? Object.entries(gameState.war_round.players)
      : []

  // Card validation regex for all manual assignments
  const validCardPattern = /^(10|[2-9]|[JQKA])[SHDC]$/

  // Helper: are all players and dealer assigned? To prevent over-assignment
  const allAssigned = useMemo(() => {
    if (gameState.war_round_active) {
      const wr = gameState.war_round
      if (!wr || !wr.players || typeof wr.dealer_card === 'undefined')
        return false
      const playerCardsAssigned =
        Object.values(wr.players).length > 0 &&
        Object.values(wr.players).every(
          card => card !== null && card !== undefined
        )
      const dealerCardAssigned = !!wr.dealer_card
      return playerCardsAssigned && dealerCardAssigned
    } else {
      return (
        Object.values(gameState.players)
          .filter(p => p)
          .every(p => p.card !== null) && !!gameState.dealer_card
      )
    }
  }, [
    gameState.war_round_active,
    gameState.war_round,
    gameState.war_round?.players,
    gameState.war_round?.dealer_card,
    gameState.players,
    gameState.dealer_card
  ])

  useEffect(() => {
    // Compare previous and current player statuses
    const prevStatuses = prevPlayerStatusesRef.current
    const currStatuses: Record<string, string> = {}
    Object.entries(gameState.players).forEach(([pid, pdata]) => {
      currStatuses[pid] = pdata.status
      if (prevStatuses[pid] && prevStatuses[pid] !== pdata.status) {
        addNotification(
          `DEBUG: Player ${pid} status changed: ${prevStatuses[pid]} → ${pdata.status}`
        )
      }
    })
    prevPlayerStatusesRef.current = currStatuses
  }, [gameState.players])

  return (
    <div className='min-h-screen'>
      {/* Header Section */}
      <nav className='relative h-[15vh] w-full overflow-hidden'>
        <img
          src='/assets/wood.png'
          alt='Wood Background'
          className='absolute inset-0 object-cover w-full h-full'
        />
        <div className='relative h-full'>
          <div className='flex items-center justify-between h-full -mt-2 xs:-mt-3 sm:-mt-4 px-2 xs:px-4 sm:px-6 md:px-8'>
            {/* Left Logo */}
            <div
              className='w-16 h-16 xs:w-20 xs:h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 lg:w-32 lg:h-32 relative flex flex-col items-center justify-center cursor-pointer hover:scale-105 transition-transform overflow-hidden'
              onClick={() => setBetMenuOpen(true)}
              aria-label='Open Bet/Table Menu'
            >
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
              <span className='text-yellow-300'>
                Table: {gameState.table_number}
              </span>
            </div>

            {/* Center Hats */}
            <div className='flex items-center justify-center gap-1 xs:gap-2 sm:gap-3 md:gap-4 lg:gap-6'>
              {Array.from({ length: 6 }, (_, i) => i + 1).map(seatNumber => {
                const playerId = seatNumber.toString()
                const isActive = gameState.players[playerId] !== undefined
                return (
                  <div
                    key={seatNumber}
                    className='w-8 h-8 xs:w-10 xs:h-10 sm:w-12 sm:h-12 md:w-16 md:h-16 lg:w-20 lg:h-20 xl:w-24 xl:h-24 2xl:w-32 2xl:h-32 relative flex items-center justify-center cursor-pointer hover:scale-105 transition-transform'
                    onClick={() => {
                      if (isActive) {
                        sendMessage({
                          action: 'remove_player',
                          player_id: playerId
                        })
                        addNotification(`Seat ${seatNumber} deactivated`)
                      } else {
                        sendMessage({
                          action: 'add_player',
                          player_id: playerId
                        })
                        addNotification(`Seat ${seatNumber} activated`)
                      }
                    }}
                  >
                    <div className='relative w-6 h-6 xs:w-8 xs:h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 lg:w-14 lg:h-14 xl:w-16 xl:h-16 2xl:w-18 2xl:h-18'>
                      <Image
                        src={
                          isActive
                            ? '/assets/whitehat.png'
                            : '/assets/redhat.png'
                        }
                        alt={isActive ? 'Active Player' : 'Inactive Player'}
                        fill
                        className='object-contain'
                        sizes='(max-width: 375px) 24px, (max-width: 640px) 32px, (max-width: 768px) 40px, (max-width: 1024px) 48px, (max-width: 1280px) 56px, 64px'
                      />
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Right Logo */}
            <div
              className='w-16 h-16 xs:w-20 xs:h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 lg:w-32 lg:h-32 relative flex items-center justify-center cursor-pointer hover:scale-105 transition-transform overflow-hidden'
              onClick={() => setMenuOpen(true)}
              aria-label='Open Game Menu'
            >
              <div className='relative w-12 h-12 xs:w-14 xs:h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 lg:w-24 lg:h-24 xl:w-28 xl:h-28'>
                <Image
                  src='/assets/menu.png'
                  alt='Menu Icon'
                  fill
                  className='object-contain'
                  sizes='(max-width: 375px) 48px, (max-width: 640px) 56px, (max-width: 768px) 64px, (max-width: 1024px) 80px, (max-width: 1280px) 96px, 112px'
                  priority
                />
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Game Controls Modal */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className='fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4'
          >
            <motion.div
              initial={{ scale: 0.9, y: -40 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: -40 }}
              className='bg-black/90 border-2 border-casino-gold rounded-2xl w-full max-w-md max-h-[90vh] relative shadow-2xl overflow-hidden flex flex-col'
            >
              {/* Fixed Header */}
              <div className='flex-shrink-0 p-6 pb-4 border-b border-casino-gold/30'>
                <button
                  className='absolute top-4 right-4 text-casino-gold hover:text-white text-2xl z-10'
                  onClick={() => setMenuOpen(false)}
                  aria-label='Close Menu'
                >
                  <FaTimesIcon />
                </button>
              </div>

              {/* Scrollable Content */}
              <div className='flex-1 overflow-y-auto px-6 py-4'>
                {/* Deck Management */}
                <div className='space-y-3 mb-6'>
                  {gameState.game_mode === 'live' ? (
                    <div className='dealer-button w-full text-center bg-black/60 border border-casino-gold rounded-lg py-2 font-bold '>
                      🃏 Deck Status: {gameState.deck_count} cards left
                    </div>
                  ) : gameState.game_mode === 'automatic' ? (
                    <>
                      <button
                        onClick={() => sendMessage({ action: 'shuffle_deck' })}
                        className='dealer-button w-full'
                      >
                        🔄 Shuffle Deck ({gameState.deck_count} cards)
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => sendMessage({ action: 'shuffle_deck' })}
                        className='dealer-button w-full'
                      >
                        🔄 Shuffle Deck ({gameState.deck_count} cards)
                      </button>
                      <button
                        onClick={() => sendMessage({ action: 'burn_card' })}
                        className='w-full bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg transition-colors'
                      >
                        🔥 Burn Card ({gameState.burned_cards_count} burned)
                      </button>
                    </>
                  )}
                </div>

                {/* Game Mode */}
                <div className='mb-6'>
                  <div className='flex rounded-lg overflow-hidden border border-casino-gold'>
                    <button
                      onClick={() => {
                        const newMode = 'live'
                        sendMessage({ action: 'set_game_mode', mode: newMode })
                        // Wait a short moment to ensure backend processes mode change before reset
                        setTimeout(() => {
                          sendMessage({ action: 'reset_game' })
                        }, 200)
                      }}
                      className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                        gameState.game_mode === 'live'
                          ? 'bg-red-700 text-white'
                          : 'bg-transparent text-casino-gold hover:bg-casino-gold/10'
                      }`}
                    >
                      Live Mode
                    </button>
                    <button
                      onClick={() => {
                        const newMode = 'automatic'
                        sendMessage({ action: 'set_game_mode', mode: newMode })
                        // Wait a short moment to ensure backend processes mode change before reset
                        setTimeout(() => {
                          sendMessage({ action: 'reset_game' })
                        }, 200)
                      }}
                      className={`flex-1 px-4 py-2 text-sm font-medium transition-colors border-l border-casino-gold ${
                        gameState.game_mode === 'automatic'
                          ? 'bg-red-700 text-white'
                          : 'bg-transparent text-casino-gold hover:bg-casino-gold/10'
                      }`}
                    >
                      Automatic Mode
                    </button>
                    <button
                      onClick={() => {
                        const newMode = 'manual'
                        sendMessage({ action: 'set_game_mode', mode: newMode })
                        // Wait a short moment to ensure backend processes mode change before reset
                        setTimeout(() => {
                          sendMessage({ action: 'reset_game' })
                        }, 200)
                      }}
                      className={`flex-1 px-4 py-2 text-sm font-medium transition-colors border-l border-casino-gold ${
                        gameState.game_mode === 'manual'
                          ? 'bg-red-700 text-white'
                          : 'bg-transparent text-casino-gold hover:bg-casino-gold/10'
                      }`}
                    >
                      Manual Mode
                    </button>
                  </div>
                </div>

                {/* AUTOMATIC MODE: START and NEW ROUND BUTTONS */}
                {gameState.game_mode === 'automatic' &&
                  !gameState.round_active &&
                  Object.keys(gameState.players).length > 0 && (
                    <div className='flex flex-col gap-2 mb-6'>
                      <button
                        className='success-button w-full'
                        onClick={() => {
                          // Start round: assign cards and evaluate
                          sendMessage({ action: 'start_auto_round' })
                        }}
                      >
                        ▶️ START
                      </button>
                      {/* Show NEW ROUND if previous round completed and players exist */}
                      {Object.values(gameState.players).some(
                        p => p.card || p.status !== 'active'
                      ) && (
                        <button
                          className='dealer-button w-full'
                          onClick={() => {
                            sendMessage({ action: 'clear_round' })
                          }}
                        >
                          🔄 NEW GAME
                        </button>
                      )}
                    </div>
                  )}

                {gameState.game_mode === 'live' && (
                  <div className='mb-6'>
                    <button
                      onClick={() => sendMessage({ action: 'evaluate_round' })}
                      className='success-button w-full mb-2'
                    >
                      ⚖️ Evaluate Round
                    </button>
                    <button
                      className='dealer-button w-full'
                      onClick={() => {
                        sendMessage({ action: 'clear_round' })
                      }}
                    >
                      🔄 NEW GAME
                    </button>
                  </div>
                )}

                {/* Card Assignment Panel for Manual/Live Mode */}
                {(gameState.game_mode === 'manual' ||
                  gameState.game_mode === 'live') && (
                  <>
                    <div className='mb-6'>
                      <label className='block text-casino-gold font-semibold mb-2 text-sm'>
                        {gameState.war_round_active
                          ? 'Assign War Card (Number & Suit)'
                          : 'Assign Card (Number & Suit)'}
                      </label>
                      <div className='flex flex-col gap-2'>
                        <div className='grid grid-cols-7 gap-1 mb-2'>
                          {[
                            'A',
                            '2',
                            '3',
                            '4',
                            '5',
                            '6',
                            '7',
                            '8',
                            '9',
                            'T',
                            'J',
                            'Q',
                            'K'
                          ].map(rank => (
                            <button
                              key={rank}
                              className={`px-2 py-1 text-xs rounded border ${
                                manualCard[0] === rank
                                  ? 'bg-casino-gold text-black'
                                  : 'bg-black text-casino-gold border-casino-gold'
                              }`}
                              onClick={() =>
                                setManualCard(rank + (manualCard[1] || ''))
                              }
                            >
                              {rank}
                            </button>
                          ))}
                        </div>
                        <div className='grid grid-cols-4 gap-2 mb-2'>
                          {['S', 'H', 'D', 'C'].map(suit => (
                            <button
                              key={suit}
                              className={`px-3 py-1 text-sm rounded border ${
                                manualCard[1] === suit
                                  ? 'bg-casino-gold text-black'
                                  : 'bg-black text-casino-gold border-casino-gold'
                              }`}
                              onClick={() =>
                                setManualCard((manualCard[0] || '') + suit)
                              }
                            >
                              {suit === 'S'
                                ? '♠'
                                : suit === 'H'
                                ? '♥'
                                : suit === 'D'
                                ? '♦'
                                : '♣'}
                            </button>
                          ))}
                        </div>
                        <button
                          className='success-button w-full text-sm'
                          disabled={manualCard.length !== 2 || allAssigned}
                          onClick={() => {
                            if (manualCard.length !== 2) return
                            if (gameState.war_round_active) {
                              // War round assignment: use EXACT same logic as normal rounds
                              const warPlayerIds = gameState.war_round
                                ? Object.keys(gameState.war_round.players)
                                    .filter(
                                      pid =>
                                        gameState.war_round &&
                                        (gameState.war_round.players[pid] ===
                                          null ||
                                          gameState.war_round.players[pid] ===
                                            undefined)
                                    )
                                    .sort((a, b) => Number(a) - Number(b))
                                : []
                              if (warPlayerIds.length > 0) {
                                sendMessage({
                                  action: 'assign_war_card',
                                  target: 'player',
                                  card: manualCard,
                                  player_id: warPlayerIds[0]
                                })
                                setManualCard('')
                                addNotification(
                                  `War card ${manualCard} assigned to player ${warPlayerIds[0]}`
                                )
                              } else if (
                                gameState.war_round &&
                                !gameState.war_round.dealer_card
                              ) {
                                sendMessage({
                                  action: 'assign_war_card',
                                  target: 'dealer',
                                  card: manualCard
                                })
                                setManualCard('')
                                addNotification(
                                  `War card ${manualCard} assigned to dealer`
                                )
                              }
                            } else {
                              // Normal round assignment
                              const playerIds = Object.keys(gameState.players)
                                .filter(
                                  pid =>
                                    gameState.players[pid] &&
                                    gameState.players[pid].card === null
                                )
                                .sort((a, b) => Number(a) - Number(b))
                              if (playerIds.length > 0) {
                                sendMessage({
                                  action: 'manual_deal_card',
                                  target: 'player',
                                  card: manualCard,
                                  player_id: playerIds[0]
                                })
                                setManualCard('')
                                addNotification(
                                  `Card ${manualCard} assigned to player ${playerIds[0]}`
                                )
                              } else if (!gameState.dealer_card) {
                                sendMessage({
                                  action: 'manual_deal_card',
                                  target: 'dealer',
                                  card: manualCard
                                })
                                setManualCard('')
                                addNotification(
                                  `Card ${manualCard} assigned to dealer`
                                )
                              }
                            }
                          }}
                        >
                          ➕ Add Card
                        </button>
                      </div>
                      {/* Disable if all players and dealer have cards (normal) or all war cards assigned (war round) */}
                      {allAssigned && (
                        <div className='text-center text-xs text-gray-400 mt-2'>
                          {gameState.war_round_active
                            ? 'All war cards have been assigned to the players and dealer.'
                            : 'All cards have been assigned to the players and dealer.'}
                        </div>
                      )}
                    </div>
                    {/* Common Card Assignment by Dropdown (Player/Dealer) */}
                    <div className='mb-6'>
                      <label className='block text-casino-gold font-semibold mb-2 text-sm'>
                        {gameState.war_round_active
                          ? 'Assign War Card to Specific Player/Dealer'
                          : 'Assign Card to Specific Player/Dealer'}
                      </label>
                      <div className='flex flex-col gap-2'>
                        <div className='flex gap-2'>
                          <select
                            value={manualCardTarget}
                            onChange={e => setManualCardTarget(e.target.value)}
                            className='bg-black border border-casino-gold rounded-lg px-3 py-2 text-white flex-1 text-sm'
                          >
                            <option value=''>Select...</option>
                            {gameState.war_round_active && gameState.war_round
                              ? Object.keys(gameState.war_round.players).map(
                                  pid => (
                                    <option key={pid} value={pid}>
                                      Player {pid}
                                    </option>
                                  )
                                )
                              : Object.keys(gameState.players).map(pid => (
                                  <option key={pid} value={pid}>
                                    Player {pid}
                                  </option>
                                ))}
                            <option value='dealer'>Dealer</option>
                          </select>
                          <input
                            type='text'
                            placeholder='Card (e.g., AS, KH)'
                            value={manualCardSpecific}
                            onChange={e =>
                              setManualCardSpecific(
                                e.target.value.toUpperCase()
                              )
                            }
                            className='bg-black border border-casino-gold rounded-lg px-3 py-2 text-white flex-1 text-sm'
                          />
                        </div>
                        <button
                          className='success-button w-full text-sm'
                          disabled={
                            !manualCardTarget ||
                            manualCardSpecific.length !== 2 ||
                            (gameState.war_round_active
                              ? manualCardTarget === 'dealer'
                                ? !!(
                                    gameState.war_round &&
                                    gameState.war_round.dealer_card
                                  )
                                : !!(
                                    gameState.war_round &&
                                    gameState.war_round.players &&
                                    gameState.war_round.players[
                                      manualCardTarget
                                    ] !== null &&
                                    gameState.war_round.players[
                                      manualCardTarget
                                    ] !== undefined
                                  )
                              : manualCardTarget === 'dealer'
                              ? !!gameState.dealer_card
                              : !!gameState.players[manualCardTarget]?.card)
                          }
                          onClick={() => {
                            if (
                              !manualCardTarget ||
                              manualCardSpecific.length !== 2
                            )
                              return
                            if (!validCardPattern.test(manualCardSpecific)) {
                              setNotifications(prev => [
                                ...prev.slice(-4),
                                'Invalid card. Please enter a valid card using ranks (2-10, J, Q, K, A) and suits (S, H, D, C).'
                              ])
                              return
                            }
                            if (gameState.war_round_active) {
                              if (manualCardTarget === 'dealer') {
                                sendMessage({
                                  action: 'assign_war_card',
                                  target: 'dealer',
                                  card: manualCardSpecific
                                })
                                addNotification(
                                  `War card ${manualCardSpecific} assigned to dealer`
                                )
                              } else {
                                sendMessage({
                                  action: 'assign_war_card',
                                  target: 'player',
                                  card: manualCardSpecific,
                                  player_id: manualCardTarget
                                })
                                addNotification(
                                  `War card ${manualCardSpecific} assigned to player ${manualCardTarget}`
                                )
                              }
                            } else {
                              if (manualCardTarget === 'dealer') {
                                sendMessage({
                                  action: 'manual_deal_card',
                                  target: 'dealer',
                                  card: manualCardSpecific
                                })
                                addNotification(
                                  `Card ${manualCardSpecific} assigned to dealer`
                                )
                              } else {
                                sendMessage({
                                  action: 'manual_deal_card',
                                  target: 'player',
                                  card: manualCardSpecific,
                                  player_id: manualCardTarget
                                })
                                addNotification(
                                  `Card ${manualCardSpecific} assigned to player ${manualCardTarget}`
                                )
                              }
                            }
                            setManualCardSpecific('')
                            setManualCardTarget('')
                          }}
                        >
                          Assign Card
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {/* Utility Controls */}
                <div className='space-y-2'>
                  {gameState.game_mode !== 'automatic' && (
                    <button
                      onClick={() => sendMessage({ action: 'undo_last_card' })}
                      className='danger-button w-full text-sm'
                    >
                      ↩️ UNDO CARD
                    </button>
                  )}
                  <button
                    onClick={() => sendMessage({ action: 'reset_game' })}
                    className='danger-button w-full text-sm'
                  >
                    🔄 CLEAR ALL STATS{' '}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bet/Table Menu Modal */}
      <AnimatePresence>
        {betMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className='fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm'
          >
            <motion.div
              initial={{ scale: 0.9, y: -40 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: -40 }}
              className='bg-black/90 border-2 border-casino-gold rounded-2xl p-8 w-full max-w-xs relative shadow-2xl'
            >
              <button
                className='absolute top-4 right-4 text-casino-gold hover:text-white text-2xl'
                onClick={() => setBetMenuOpen(false)}
                aria-label='Close Bet/Table Menu'
              >
                <FaTimesIcon />
              </button>
              <h2 className='text-xl font-bold text-casino-gold mb-4 text-center'>
                Table & Betting
              </h2>
              <div className='mb-4'>
                <label className='block text-casino-gold font-semibold mb-2'>
                  Table Number
                </label>
                <input
                  type='text'
                  inputMode='numeric'
                  pattern='[0-9]*'
                  value={pendingTableNumber}
                  onChange={e =>
                    setPendingTableNumber(
                      e.target.value === ''
                        ? 0
                        : Number(e.target.value.replace(/\D/g, ''))
                    )
                  }
                  className='w-full bg-black border border-casino-gold rounded-lg px-3 py-2 text-white appearance-none'
                  style={{ MozAppearance: 'textfield' }}
                />
              </div>
              <div className='mb-4'>
                <label className='block text-casino-gold font-semibold mb-2'>
                  Min Bet
                </label>
                <input
                  type='text'
                  inputMode='numeric'
                  pattern='[0-9]*'
                  value={pendingMinBet}
                  onChange={e =>
                    setPendingMinBet(
                      e.target.value === ''
                        ? 0
                        : Number(e.target.value.replace(/\D/g, ''))
                    )
                  }
                  className='w-full bg-black border border-casino-gold rounded-lg px-3 py-2 text-white appearance-none'
                  style={{ MozAppearance: 'textfield' }}
                />
              </div>
              <div className='mb-4'>
                <label className='block text-casino-gold font-semibold mb-2'>
                  Max Bet
                </label>
                <input
                  type='text'
                  inputMode='numeric'
                  pattern='[0-9]*'
                  value={pendingMaxBet}
                  onChange={e =>
                    setPendingMaxBet(
                      e.target.value === ''
                        ? 0
                        : Number(e.target.value.replace(/\D/g, ''))
                    )
                  }
                  className='w-full bg-black border border-casino-gold rounded-lg px-3 py-2 text-white appearance-none'
                  style={{ MozAppearance: 'textfield' }}
                />
              </div>
              <button
                className='success-button w-full'
                onClick={() => {
                  sendMessage({
                    action: 'change_bets',
                    min_bet: pendingMinBet,
                    max_bet: pendingMaxBet
                  })
                  sendMessage({
                    action: 'change_table',
                    table_number: pendingTableNumber
                  })
                  setBetMenuOpen(false)
                  addNotification('Table and betting updated')
                }}
              >
                Save
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {notifications.map((notification, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, x: 300 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -300 }}
            className='fixed top-20 right-6 bg-casino-gold text-black px-4 py-2 rounded-lg shadow-lg z-50 mb-2'
            style={{ top: `${80 + index * 60}px` }}
          >
            {notification}
          </motion.div>
        ))}
      </AnimatePresence>

      <div className='grid grid-cols-1 lg:grid-cols-3 gap-6'>
        {/* Game Table */}
        <div className='lg:col-span-3 mx-6'>
          <div className='bg-[#911606] border-4 border-[#d4af37] p-6 mb-6 w-full grow flex flex-col'>
            {/* Flex container for Dealer + Game Info layout */}
            <div className='flex flex-col lg:flex-row gap-6 mb-6'>
              {/* Left side - Dealer section */}
              <div className='lg:w-2/3'>
                {!gameState.war_round_active ||
                !gameState.war_round?.original_cards ? (
                  <div className='mb-0'>
                    {/* Dealer section styling to match the image */}
                    <div className='bg-[#911606] border-2 border-dashed border-white p-6 rounded-lg'>
                      <h3 className='text-xl font-medium font-[questrial] tracking-widest text-white'>
                        Dealer's Cards
                      </h3>

                      <div className='flex justify-center items-center min-h-[120px]'>
                        {/* After war round, show both original and war card stacked */}
                        {!gameState.war_round_active &&
                        gameState.war_round?.original_cards?.dealer_card ? (
                          <div className='flex flex-col items-center gap-1'>
                            {renderCard(
                              gameState.war_round.original_cards.dealer_card,
                              'medium'
                            )}
                            {gameState.war_round?.dealer_card && (
                              <div className='mt-1'>
                                {renderCard(
                                  gameState.war_round.dealer_card,
                                  'medium'
                                )}
                              </div>
                            )}
                          </div>
                        ) : // Normal round: show only the original card
                        gameState.dealer_card ? (
                          renderCard(gameState.dealer_card, 'medium')
                        ) : (
                          <div className='w-20 h-28 card-back rounded-lg flex items-center justify-center'>
                            <span className='text-white text-2xl'>?</span>
                          </div>
                        )}
                      </div>
                      {/* Dealer card assignment textbox and button removed as requested */}
                    </div>
                  </div>
                ) : (
                  // If war round is active, still show the dealer card assignment input in live mode ONLY if round is active
                  gameState.game_mode === 'live' &&
                  gameState.round_active && (
                    <div className='text-center mb-8'>
                      <h3 className='text-xl font-bold text-casino-gold mb-4'>
                        Dealer
                      </h3>
                      {/* <div className="mt-4">
                        <input 
                          type="texwt" 
                          placeholder="Manual card (e.g., AS, KH)"
                          value={manualCard}
                          onChange={(e) => setManualCard(e.target.value.toUpperCase())}
                          className="bg-black border border-casino-gold rounded-lg px-3 py-2 text-white mr-2"
                        />
                        <button 
                          onClick={() => {
                            if (manualCard) {
                              if (!validCardPattern.test(manualCard)) {
                                setNotifications(prev => [
                                  ...prev.slice(-4),
                                  "Invalid card. Please enter a valid card using ranks (2-10, J, Q, K, A) and suits (S, H, D, C)."
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
                      </div> */}
                    </div>
                  )
                )}
              </div>

              {/* Right side - Game information */}
              <div className='lg:w-1/3 flex flex-col justify-start items-end'>
                {/* Game information styled as yellow lines */}
                <div className='mb-3 p-2'>
                  <h2 className='text-xl font-bold text-yellow-300'>
                    Round {gameState.round_number}{' '}
                    {gameState.round_active ? '(Active)' : ''}
                  </h2>
                </div>

                <div className='mb-3 p-2'>
                  <div className='text-yellow-300 font-semibold'>
                    Table: {gameState.table_number}
                  </div>
                </div>

                <div className='mb-3 p-2'>
                  <div className='text-yellow-300 font-semibold'>
                    Betting: ${gameState.min_bet} - ${gameState.max_bet}
                  </div>
                </div>

                <div className='mb-3 p-2'>
                  <div className='text-yellow-300 font-semibold'>
                    Players: {Object.keys(gameState.players).length}/6
                  </div>
                </div>
              </div>
            </div>

            {/* War Round Section */}
            {gameState.war_round_active && (
              <div className='bg-red-900/30 border-2 border-red-500 rounded-xl p-6 mb-8'>
                <h3 className='text-xl font-bold text-red-400 mb-4 text-center'>
                  ⚔️ WAR ROUND ⚔️
                </h3>

                <div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
                  {/* War Dealer Card */}
                  <div className='text-center'>
                    <h4 className='text-lg font-semibold text-red-400 mb-2'>
                      Dealer War Card
                    </h4>
                    <div className='flex justify-center mb-4'>
                      {gameState.war_round?.dealer_card ? (
                        renderCard(gameState.war_round.dealer_card, 'medium')
                      ) : (
                        <div className='w-16 h-22 card-back rounded-lg flex items-center justify-center'>
                          <span className='text-white'>🎴</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* War Player Cards */}
                  <div className='text-center'>
                    <h4 className='text-lg font-semibold text-red-400 mb-2'>
                      Player War Cards
                    </h4>
                    <div className='space-y-2'>
                      {gameState.war_round &&
                        Object.entries(gameState.war_round.players).map(
                          ([playerId, card]) => (
                            <div
                              key={playerId}
                              className='flex items-center justify-between bg-black/30 rounded-lg p-2'
                            >
                              <span className='text-white'>{playerId}</span>
                              <div className='flex items-center gap-2'>
                                {card ? (
                                  renderCard(card, 'small')
                                ) : (
                                  <div className='w-12 h-16 card-back rounded flex items-center justify-center'>
                                    <span className='text-white text-xs'>
                                      🎴
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        )}
                    </div>
                  </div>
                </div>

                {/* War Card Assignment Controls */}
                <div className='mt-6 p-4 bg-black/30 rounded-lg'>
                  <h4 className='text-lg font-semibold text-casino-gold mb-3'>
                    Assign War Cards
                  </h4>
                  <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
                    <select
                      value={warCardTarget}
                      onChange={e =>
                        setWarCardTarget(e.target.value as 'dealer' | 'player')
                      }
                      className='bg-black border border-casino-gold rounded-lg px-3 py-2 text-white'
                    >
                      <option value='dealer'>Dealer</option>
                      <option value='player'>Player</option>
                    </select>

                    {warCardTarget === 'player' && (
                      <select
                        value={warPlayerId}
                        onChange={e => setWarPlayerId(e.target.value)}
                        className='bg-black border border-casino-gold rounded-lg px-3 py-2 text-white'
                      >
                        <option value=''>Select Player</option>
                        {warPlayers.map(([playerId]) => (
                          <option key={playerId} value={playerId}>
                            {playerId}
                          </option>
                        ))}
                      </select>
                    )}

                    <div className='flex gap-2'>
                      <input
                        type='text'
                        placeholder='Card (e.g., AS, KH)'
                        value={warCardValue}
                        onChange={e =>
                          setWarCardValue(e.target.value.toUpperCase())
                        }
                        className='flex-1 bg-black border border-casino-gold rounded-lg px-3 py-2 text-white'
                      />
                      <button
                        onClick={() => {
                          if (
                            !warCardValue ||
                            (warCardTarget === 'player' && !warPlayerId)
                          ) {
                            setNotifications(prev => [
                              ...prev.slice(-4),
                              'Please enter a card value and select a player if target is Player.'
                            ])
                            return
                          }
                          if (!validCardPattern.test(warCardValue)) {
                            setNotifications(prev => [
                              ...prev.slice(-4),
                              'Invalid card. Please enter a valid card using ranks (2-10, J, Q, K, A) and suits (S, H, D, C).'
                            ])
                            return
                          }
                          sendMessage({
                            action: 'assign_war_card',
                            target: warCardTarget,
                            card: warCardValue,
                            player_id:
                              warCardTarget === 'player'
                                ? warPlayerId
                                : undefined
                          })
                          setWarCardValue('')
                          setWarPlayerId('')
                        }}
                        className='success-button'
                      >
                        Assign
                      </button>
                    </div>
                  </div>

                  <button
                    onClick={() =>
                      sendMessage({ action: 'evaluate_war_round' })
                    }
                    className='mt-4 w-full bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors font-semibold'
                  >
                    ⚖️ Evaluate War Round
                  </button>
                </div>

                {/* Removed the separate Undo War Card button and logic */}
              </div>
            )}

            {/* Original Cards Section */}
            {gameState.war_round_active && gameState.war_round?.original_cards && (
              <div className='bg-yellow-900/20 border-2 border-yellow-500 rounded-xl p-4 mb-4'>
                <h4 className='text-lg font-semibold text-yellow-400 mb-2 text-center'>
                  Original Cards That Caused the Tie
                </h4>
                <div className='flex flex-wrap justify-center gap-8'>
                  <div className='text-center'>
                    <div className='text-yellow-400 font-bold mb-1'>Dealer</div>
                    {renderCard(
                      gameState.war_round.original_cards.dealer_card,
                      'large'
                    )}
                  </div>
                  {Object.entries(
                    gameState.war_round.original_cards.players
                  ).map(([pid, card]) => (
                    <div key={pid} className='text-center'>
                      <div className='text-yellow-400 font-bold mb-1'>
                        Player {pid}
                      </div>
                      {renderCard(card, 'large')}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Players Section */}
            {!gameState.war_round_active ||
            !gameState.war_round?.original_cards ? (
              <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'>
                {Object.entries(gameState.players).map(
                  ([playerId, playerData]) => (
                    <motion.div
                      key={playerId}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className='bg-red-400/5 border-2 border-dashed border-white p-4 rounded-lg'
                    >
                      <div className='flex justify-between items-center mb-3'>
                        <h4 className='text-lg font-normal font-[questrial] tracking-widest text-white'>
                          Player {playerId}
                        </h4>
                        <div
                          className={`px-2 py-1 rounded-full text-xs font-semibold ${
                            playerData.status === 'active'
                              ? 'bg-green-500/20 text-green-400'
                              : playerData.status === 'war'
                              ? 'bg-red-500/20 text-red-400'
                              : playerData.status === 'waiting_choice'
                              ? 'bg-yellow-500/20 text-yellow-400'
                              : playerData.status === 'surrender'
                              ? 'bg-gray-500/20 text-gray-400'
                              : 'bg-gray-500/20 text-gray-400'
                          }`}
                        >
                          {playerData.status === 'surrender'
                            ? 'SURRENDER'
                            : playerData.status.replace('_', ' ').toUpperCase()}
                        </div>
                      </div>
                      <div className='flex flex-col items-center mb-3 gap-1'>
                        {/* After war round, show both original and war card stacked */}
                        {!gameState.war_round_active &&
                        gameState.war_round?.original_cards?.players?.[
                          playerId
                        ] ? (
                          <div className='flex justify-center items-center gap-4'>
                            <div className='text-center mb-3'>
                              <div className='text-xs text-casino-gold font-medium mb-1'>
                                Original
                              </div>
                              <div className='flex justify-center'>
                                {renderCard(
                                  gameState.war_round?.original_cards
                                    ?.players?.[playerId],
                                  'medium'
                                )}
                              </div>
                            </div>
                            {playerData.war_card && (
                              <div className='text-center mb-3'>
                                <div className='text-xs text-[#808000] font-medium mb-1'>
                                  War
                                </div>
                                <div className='flex justify-center'>
                                  {renderCard(playerData.war_card, 'medium')}
                                </div>
                              </div>
                            )}
                          </div>
                        ) : // Normal round: show only the original card
                        playerData.card ? (
                          renderCard(playerData.card, 'medium')
                        ) : (
                          <div className='w-20 h-28 card-back rounded-lg flex items-center justify-center'>
                            <span className='text-white text-2xl'>?</span>
                          </div>
                        )}
                      </div>

                      {gameState.game_mode === 'live' &&
                        (gameState.round_active || !playerData.card) &&
                        (!gameState.war_round ||
                          gameState.war_round_active ||
                          !gameState.war_round.original_cards) && (
                          <div className='mt-3 space-y-2'>
                            {/* <input 
                          type="text" 
                          placeholder="Card (e.g., AS, KH)"
                          className="w-full bg-black border border-casino-gold rounded px-2 py-1 text-white text-sm"
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              const card = (e.target as HTMLInputElement).value.toUpperCase();
                              if (card) {
                                if (!validCardPattern.test(card)) {
                                  setNotifications(prev => [
                                    ...prev.slice(-4),
                                    "Invalid card. Please enter a valid card using ranks (2-10, J, Q, K, A) and suits (S, H, D, C)."
                                  ]);
                                  return;
                                }
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
                        /> */}
                          </div>
                        )}

                      {playerData.result && (
                        <div
                          className={`text-center mt-3 px-4 py-2 rounded-lg text-sm font-bold
                            transform transition-all duration-200 shadow-lg border ${
                              playerData.result === 'win'
                                ? 'bg-gradient-to-r from-green-700/80 to-green-500/80 text-white border-green-400 shadow-green-900/50'
                                : playerData.result === 'lose'
                                ? 'bg-gradient-to-r from-red-700/80 to-red-500/80 text-white border-red-400 shadow-red-900/50'
                                : playerData.result === 'surrender'
                                ? 'bg-gradient-to-r from-gray-700/80 to-gray-500/80 text-gray-200 border-gray-400 shadow-gray-900/50'
                                : 'bg-gradient-to-r from-yellow-600/80 to-amber-500/80 text-white border-yellow-400 shadow-amber-900/50'
                            }`}
                        >
                          <div className='flex items-center justify-center gap-2'>
                            {playerData.result === 'win' && (
                              <span className='text-yellow-300'>🏆</span>
                            )}
                            {playerData.result === 'lose' && <span>❌</span>}
                            {playerData.result === 'surrender' && (
                              <span>🏳️</span>
                            )}
                            {playerData.result !== 'win' &&
                              playerData.result !== 'lose' &&
                              playerData.result !== 'surrender' && (
                                <span>⚠️</span>
                              )}
                            <span className='tracking-wider'>
                              {playerData.result === 'surrender'
                                ? 'SURRENDER'
                                : playerData.result.toUpperCase()}
                            </span>
                          </div>
                        </div>
                      )}

                      {playerData.status === 'waiting_choice'}
                    </motion.div>
                  )
                )}

                {Object.keys(gameState.players).length === 0 && (
                  <div className='col-span-full text-center py-12 text-gray-400'>
                    <div className='text-6xl mb-4'>🎲</div>
                    <p className='text-xl'>No players at the table</p>
                    <p className='text-sm'>Add players to start the game</p>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <style jsx>{`
        .card {
          background: white;
          border: 2px solid #d4af37;
          border-radius: 8px;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.5);
        }
        .card-back {
          background: #6b0000;
          border: 2px solid #d4af37;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.5);
        }

        .dealer-button {
          @apply g-gradient-to-r from-yellow-600 to-yellow-700 hover:from-yellow-700 hover:to-yellow-800 text-white px-4 py-2 rounded-lg transition-all duration-200 font-semibold shadow-lg;
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
        .table-number {
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8);
        }
        .logo-container {
          filter: drop-shadow(0 8px 12px rgba(0, 0, 0, 0.6));
          transition: all 0.2s ease;
        }
        .logo-container:hover {
          transform: translateY(-2px);
          filter: drop-shadow(0 10px 14px rgba(0, 0, 0, 0.7));
        }
      `}</style>
      <style jsx global>{`
        body {
          background: radial-gradient(circle, #450a03);
          color: #fff;
        }
      `}</style>
    </div>
  )
}
