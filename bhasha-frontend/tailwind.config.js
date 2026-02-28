/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: '#0A84FF',
        danger: '#FF3B30',
        success: '#30D158',
        warning: '#FF9F0A',
        surface: '#F2F2F7',
        card: '#FFFFFF',
      },
      borderRadius: {
        'xl': '16px',
        '2xl': '24px',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'Segoe UI', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
