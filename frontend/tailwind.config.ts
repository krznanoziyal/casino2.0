import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}'
  ],
  theme: {
    extend: {
      colors: {
        casino: {
          green: '#0f4c3a',
          darkGreen: '#0d2818',
          gold: '#ffd700',
          red: '#dc2626',
          blue: '#1e40af'
        }
      },
      animation: {
        'spin-slow': 'spin 3s linear infinite',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        glow: 'glow 2s ease-in-out infinite alternate'
      },
      keyframes: {
        glow: {
          '0%': {
            boxShadow: '0 0 5px #ffd700, 0 0 10px #ffd700, 0 0 15px #ffd700'
          },
          '100%': {
            boxShadow: '0 0 10px #ffd700, 0 0 20px #ffd700, 0 0 30px #ffd700'
          }
        }
      },
      fontFamily: {
        questrial: ['var(--font-questrial)', 'sans-serif']
      }
    }
  },
  plugins: []
}

export default config
