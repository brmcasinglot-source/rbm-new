import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import apiHandler from './api/index.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value
  }

  return {
    plugins: [
      react(),
      {
        name: 'local-api',
        configureServer(server) {
          server.middlewares.use('/api', (req, res) => {
            apiHandler(req, res).catch((error) => {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
              res.end(JSON.stringify({ error: error.message }))
            })
          })
        },
      },
    ],
  }
})
