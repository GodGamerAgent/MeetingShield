/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: "#FFFDFB",
          mist: "#FFF4EE",
          card: "rgba(255, 255, 255, 0.85)",
          peach: "#FF9E7D",
          coral: "#FF7F50",
          pastel: "#FFD8C7",
          border: "#FFE5D9",
          charcoal: "#2B2129",
          slate: "#6E5D68",
          amber: "#F59E0B",
          emerald: "#10B981",
          rose: "#F43F5E",
        }
      },
      boxShadow: {
        'peach-sm': '0 2px 10px rgba(255, 158, 125, 0.08)',
        'peach-md': '0 8px 30px rgba(255, 158, 125, 0.12)',
        'peach-lg': '0 16px 48px rgba(255, 127, 80, 0.18)',
        'glass': '0 8px 32px 0 rgba(255, 158, 125, 0.09)',
      },
      animation: {
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float': 'float 6s ease-in-out infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        }
      }
    },
  },
  plugins: [],
};
