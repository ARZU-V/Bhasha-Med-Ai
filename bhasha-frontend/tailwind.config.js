/** @type {import('tailwindcss').Config} */
export default {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
  	extend: {
  		colors: {
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			danger: '#DC2626',
  			success: '#16A34A',
  			warning: '#B45309',
  			ink: '#111110',
  			'ink-2': '#6B6B6B',
  			'ink-3': '#A3A09B',
  			base: '#F8F7F5',
  			surface: '#FFFFFF',
  			'surface-2': '#F4F3F1',
  			line: '#E5E4E1',
  			'line-2': '#EDECE9',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			}
  		},
  		borderRadius: {
  			sm: 'calc(var(--radius) - 4px)',
  			DEFAULT: '8px',
  			md: 'calc(var(--radius) - 2px)',
  			lg: 'var(--radius)',
  			xl: '14px',
  			'2xl': '18px',
  			'3xl': '24px',
  			full: '9999px'
  		},
  		fontFamily: {
  			sans: [
  				'Inter',
  				'-apple-system',
  				'BlinkMacSystemFont',
  				'SF Pro Text',
  				'Segoe UI',
  				'sans-serif'
  			]
  		},
  		fontSize: {
  			'2xs': [
  				'11px',
  				{
  					lineHeight: '15px'
  				}
  			],
  			xs: [
  				'12px',
  				{
  					lineHeight: '17px'
  				}
  			],
  			sm: [
  				'13px',
  				{
  					lineHeight: '20px'
  				}
  			],
  			base: [
  				'14px',
  				{
  					lineHeight: '22px'
  				}
  			],
  			md: [
  				'15px',
  				{
  					lineHeight: '24px'
  				}
  			],
  			lg: [
  				'16px',
  				{
  					lineHeight: '24px'
  				}
  			],
  			xl: [
  				'18px',
  				{
  					lineHeight: '26px'
  				}
  			],
  			'2xl': [
  				'21px',
  				{
  					lineHeight: '28px'
  				}
  			],
  			'3xl': [
  				'26px',
  				{
  					lineHeight: '32px'
  				}
  			]
  		},
  		boxShadow: {
  			card: '0 1px 2px rgba(0,0,0,0.05), 0 0 0 1px rgba(0,0,0,0.04)',
  			lifted: '0 4px 16px rgba(0,0,0,0.08)',
  			float: '0 12px 32px rgba(0,0,0,0.12)'
  		},
  		letterSpacing: {
  			tightest: '-0.03em',
  			tighter: '-0.02em',
  			tight: '-0.01em',
  			normal: '0em',
  			wide: '0.03em',
  			widest: '0.08em'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
}
