import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { MongoClient, ObjectId } from 'mongodb'
import jwt from 'jsonwebtoken'

dotenv.config()

const app = express()
const port = process.env.PORT || 8000

app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true,
  })
)

app.use(express.json())

const uri = process.env.MONGODB_URI

if (!uri) {
  throw new Error('MONGODB_URI is missing from the .env file')
}

const client = new MongoClient(uri)
let db

async function connectDB() {
  try {
    await client.connect()

    db = client.db('booknook')

    await db.command({ ping: 1 })

    console.log(' Connected to MongoDB Atlas successfully!')
  } catch (error) {
    console.error(' MongoDB connection error:', error.message)
    process.exit(1)
  }
}

function books() {
  return db.collection('books')
}

function borrows() {
  return db.collection('borrows')
}

function isValidId(id) {
  return ObjectId.isValid(id) && String(new ObjectId(id)) === id
}

function handleError(res, error) {
  console.error(error)
  return res.status(500).json({
    message: 'Internal server error',
  })
}

const JWT_SECRET = process.env.JWT_SECRET || 'booknook-jwt-secret'

function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized: No token provided' })
  }
  const token = authHeader.split(' ')[1]
  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    req.user = decoded
    next()
  } catch {
    return res.status(403).json({ message: 'Forbidden: Invalid or expired token' })
  }
}

app.get('/', (req, res) => {
  res.json({
    message: ' BookNook API is running!',
    status: 'OK',
  })
})

app.post('/jwt', (req, res) => {
  const { email } = req.body
  if (!email) {
    return res.status(400).json({ message: 'Email is required' })
  }
  const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '7d' })
  res.json({ token })
})

app.get('/books', async (req, res) => {
  try {
    const { sort, limit } = req.query

    let query = books().find({})

    if (sort === 'newest') {
      query = query.sort({ createdAt: -1 })
    }

    const parsedLimit = Number.parseInt(limit, 10)

    if (Number.isInteger(parsedLimit) && parsedLimit > 0) {
      query = query.limit(parsedLimit)
    }

    const result = await query.toArray()

    res.json(result)
  } catch (error) {
    handleError(res, error)
  }
})