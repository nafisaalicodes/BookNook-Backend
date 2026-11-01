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