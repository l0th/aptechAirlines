/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#0A2540',
          dark: '#061727',
          light: '#13395F',
        },
        ocean: {
          DEFAULT: '#1E3A8A',
          light: '#2563EB',
        },
        gold: {
          DEFAULT: '#D4AF37',
          light: '#F59E0B',
          dark: '#B45309',
        },
        semantic: {
          business: '#D4AF37',
          available: '#10B981',
          exit: '#0284C7',
          selected: '#F59E0B',
          occupied: '#94A3B8',
          delayed: '#F59E0B',
          cancelled: '#EF4444',
        }
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

