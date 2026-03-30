/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#0ea5e9',
        background: '#fafafa',
        'text-primary': '#18181b',
        'text-secondary': '#71717a',
        platform: {
          douyin: '#fe2c55',
          bilibili: '#00a1d6',
          xiaohongshu: '#ff2442',
          kuaishou: '#ff4906',
          youtube: '#ff0000',
        },
      },
      borderRadius: {
        DEFAULT: '12px',
        lg: '16px',
      },
      boxShadow: {
        'soft': '0 2px 8px rgba(0,0,0,0.06)',
        'card': '0 4px 12px rgba(0,0,0,0.08)',
      },
      fontFamily: {
        sans: [
          '"Noto Sans SC"',
          '"Manrope"',
          'PingFang SC',
          'Hiragino Sans GB',
          'Microsoft YaHei',
          'system-ui',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
}
