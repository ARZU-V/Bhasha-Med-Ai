/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand — deeper, more considered than iOS defaults
        primary:  '#2563EB',
        danger:   '#DC2626',
        success:  '#16A34A',
        warning:  '#B45309',

        // Ink scale — warm near-blacks, not pure gray
        ink:    '#111110',
        'ink-2':'#6B6B6B',
        'ink-3':'#A3A09B',

        // Surface scale
        base:    '#F8F7F5',   // page background (warm off-white)
        surface: '#FFFFFF',   // card / panel
        'surface-2': '#F4F3F1', // secondary panel / input bg

        // Border
        line:  '#E5E4E1',
        'line-2': '#EDECE9',

        // Legacy aliases so old code doesn't break
        card: '#FFFFFF',
      },

      borderRadius: {
        sm:  '6px',
        DEFAULT: '8px',
        md:  '10px',
        lg:  '12px',
        xl:  '14px',
        '2xl': '18px',
        '3xl': '24px',
        full: '9999px',
      },

      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'Segoe UI', 'sans-serif'],
      },

      fontSize: {
        '2xs': ['11px', { lineHeight: '15px' }],
        xs:   ['12px', { lineHeight: '17px' }],
        sm:   ['13px', { lineHeight: '20px' }],
        base: ['14px', { lineHeight: '22px' }],
        md:   ['15px', { lineHeight: '24px' }],
        lg:   ['16px', { lineHeight: '24px' }],
        xl:   ['18px', { lineHeight: '26px' }],
        '2xl':['21px', { lineHeight: '28px' }],
        '3xl':['26px', { lineHeight: '32px' }],
      },

      boxShadow: {
        card:    '0 1px 2px rgba(0,0,0,0.05), 0 0 0 1px rgba(0,0,0,0.04)',
        lifted:  '0 4px 16px rgba(0,0,0,0.08)',
        float:   '0 12px 32px rgba(0,0,0,0.12)',
      },

      letterSpacing: {
        tightest: '-0.03em',
        tighter:  '-0.02em',
        tight:    '-0.01em',
        normal:    '0em',
        wide:      '0.03em',
        widest:    '0.08em',
      },
    },
  },
  plugins: [],
}
