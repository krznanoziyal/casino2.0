import React, { useEffect, useState } from "react";
import Confetti from "react-confetti";
import { motion, AnimatePresence } from "framer-motion";

const WinnerModal = ({ show, onClose, playerResult }: { show: boolean; onClose: () => void; playerResult: string | null }) => {
  const [showConfetti, setShowConfetti] = useState(false);

  useEffect(() => {
    if (show) {
      setShowConfetti(true);
      console.log("Player Result:", playerResult);

      // Play the audio when modal opens
      const audio = new Audio("/assets/winner-sound.mp3");
      // audio.play();

      // Hide the modal after 5 seconds
      const timer = setTimeout(() => {
        onClose();
      }, 5000);

      // Stop confetti after 5 seconds (only show for wins)
      const confettiTimer = setTimeout(() => {
        setShowConfetti(false);
      }, 5000);

      return () => {
        clearTimeout(timer);
        clearTimeout(confettiTimer);
      };
    }
  }, [show, onClose]);

  if (!show || !playerResult) return null;

  // Only show confetti for wins
  const shouldShowConfetti = showConfetti && playerResult === 'win';

  return (
    <AnimatePresence>
      {show && (
        <div className="fixed h-screen w-full z-50 inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          {shouldShowConfetti && <Confetti />}
          
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0, rotate: 180 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="bg-gradient-to-br from-casino-gold to-yellow-600 rounded-3xl shadow-2xl border-4 border-white p-8 w-full max-w-lg mx-4 flex flex-col items-center text-center"
          >
            {/* Winner Crown/Trophy */}
            <motion.div
              initial={{ y: -50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.5 }}
              className="text-6xl mb-4"
            >
              {playerResult === 'win' ? '👑' : playerResult === 'lose' ? '😞' : playerResult === 'surrender' ? '🏳️' : '🤝'}
            </motion.div>

            {/* Result Content */}
            <div className="flex flex-col items-center justify-center space-y-4">
              {playerResult === 'win' && (
                <>
                  {/* Player Wins */}
                  <motion.div
                    initial={{ x: -100, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: 0.5, duration: 0.5 }}
                    className="flex items-center space-x-4"
                  >
                    <div className="w-20 h-20 bg-green-600 rounded-full flex items-center justify-center shadow-lg">
                      <span className="text-3xl">🎉</span>
                    </div>
                    <div className="text-4xl font-bold text-white drop-shadow-lg">
                      YOU
                    </div>
                  </motion.div>
                  
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.7, duration: 0.4 }}
                    className="text-5xl font-extrabold text-white drop-shadow-2xl"
                  >
                    WIN!
                  </motion.div>
                  
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.9, duration: 0.3 }}
                    className="text-xl font-semibold text-green-100"
                  >
                    Congratulations! 🏆
                  </motion.div>
                </>
              )}
              
              {playerResult === 'lose' && (
                <>
                  {/* Dealer Wins */}
                  <motion.div
                    initial={{ x: 100, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: 0.5, duration: 0.5 }}
                    className="flex items-center space-x-4"
                  >
                    <div className="w-20 h-20 bg-red-600 rounded-full flex items-center justify-center shadow-lg">
                      <span className="text-3xl">🎰</span>
                    </div>
                    <div className="text-4xl font-bold text-white drop-shadow-lg">
                      DEALER
                    </div>
                  </motion.div>
                  
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.7, duration: 0.4 }}
                    className="text-5xl font-extrabold text-white drop-shadow-2xl"
                  >
                    WINS!
                  </motion.div>
                  
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.9, duration: 0.3 }}
                    className="text-xl font-semibold text-red-100"
                  >
                    Better luck next time! 🎲
                  </motion.div>
                </>
              )}

              {playerResult === 'surrender' && (
                <>
                  {/* Player Surrendered */}
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.5, duration: 0.5 }}
                    className="flex items-center space-x-4"
                  >
                    <div className="w-20 h-20 bg-gray-600 rounded-full flex items-center justify-center shadow-lg">
                      <span className="text-3xl">🏳️</span>
                    </div>
                    <div className="text-4xl font-bold text-white drop-shadow-lg">
                      SURRENDER
                    </div>
                  </motion.div>
                  
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.7, duration: 0.3 }}
                    className="text-xl font-semibold text-gray-100"
                  >
                    You chose to surrender 🤝
                  </motion.div>
                </>
              )}

              {(playerResult === 'tie' || (!['win', 'lose', 'surrender'].includes(playerResult))) && (
                <>
                  {/* Tie/Other */}
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.5, duration: 0.5 }}
                    className="flex items-center space-x-4"
                  >
                    <div className="w-20 h-20 bg-orange-600 rounded-full flex items-center justify-center shadow-lg">
                      <span className="text-3xl">🤝</span>
                    </div>
                    <div className="text-4xl font-bold text-white drop-shadow-lg">
                      TIE!
                    </div>
                  </motion.div>
                  
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.7, duration: 0.3 }}
                    className="text-xl font-semibold text-orange-100"
                  >
                    It's a draw! ⚖️
                  </motion.div>
                </>
              )}
            </div>

            {/* Sparkle Animation */}
            <motion.div
              animate={{ 
                rotate: 360,
                scale: [1, 1.1, 1]
              }}
              transition={{ 
                rotate: { duration: 3, repeat: Infinity, ease: "linear" },
                scale: { duration: 2, repeat: Infinity, ease: "easeInOut" }
              }}
              className="absolute top-4 right-4 text-2xl"
            >
              ✨
            </motion.div>
            
            <motion.div
              animate={{ 
                rotate: -360,
                scale: [1, 1.2, 1]
              }}
              transition={{ 
                rotate: { duration: 4, repeat: Infinity, ease: "linear" },
                scale: { duration: 1.5, repeat: Infinity, ease: "easeInOut" }
              }}
              className="absolute bottom-4 left-4 text-2xl"
            >
              💫
            </motion.div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default WinnerModal;