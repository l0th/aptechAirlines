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
      // Keyframes cho các hiệu ứng được dùng trong modal/toast.
      // Trước đây class animate-fade-in / animate-slide-in được dùng nhưng
      // chưa hề được định nghĩa nên animation không chạy.
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-in': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out',
        'slide-in': 'slide-in 250ms ease-out',
        'scale-in': 'scale-in 200ms ease-out',
      },
    },
  },
  plugins: [],
};
