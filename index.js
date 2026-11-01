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

app.get('/books/:id', async (req, res) => {
  try {
    const { id } = req.params

    if (!isValidId(id)) {
      return res.status(400).json({
        message: 'Invalid book ID',
      })
    }

    const book = await books().findOne({
      _id: new ObjectId(id),
    })

    if (!book) {
      return res.status(404).json({
        message: 'Book not found',
      })
    }

    res.json(book)
  } catch (error) {
    handleError(res, error)
  }
})

app.post('/books', async (req, res) => {
  try {
    const {
      title,
      author,
      category,
      image,
      description,
      userName,
      userEmail,
      totalCopies,
    } = req.body

    if (
      !title ||
      !author ||
      !category ||
      !description ||
      !userEmail
    ) {
      return res.status(400).json({
        message:
          'Title, author, category, description, and user email are required',
      })
    }

    const copies = Number(totalCopies ?? 1)

    if (!Number.isInteger(copies) || copies < 1) {
      return res.status(400).json({
        message: 'Total copies must be a positive integer',
      })
    }

    const newBook = {
      title,
      author,
      category,
      image: image || '',
      description,
      userName: userName || '',
      userEmail,
      totalCopies: copies,
      availableCopies: copies,
      createdAt: new Date(),
    }

    const result = await books().insertOne(newBook)

    res.status(201).json({
      message: 'Book added successfully',
      insertedId: result.insertedId,
      book: {
        ...newBook,
        _id: result.insertedId,
      },
    })
  } catch (error) {
    handleError(res, error)
  }
})

app.patch('/books/:id', async (req, res) => {
  try {
    const { id } = req.params

    if (!isValidId(id)) {
      return res.status(400).json({
        message: 'Invalid book ID',
      })
    }

    const allowedFields = [
      'title',
      'author',
      'category',
      'image',
      'description',
      'totalCopies',
    ]

    const updates = {}

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field]
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        message: 'No valid fields provided for update',
      })
    }

    if (updates.totalCopies !== undefined) {
      const total = Number(updates.totalCopies)

      if (!Number.isInteger(total) || total < 1) {
        return res.status(400).json({
          message: 'Total copies must be a positive integer',
        })
      }

      const existingBook = await books().findOne({
        _id: new ObjectId(id),
      })

      if (!existingBook) {
        return res.status(404).json({
          message: 'Book not found',
        })
      }

      const borrowedCopies =
        (existingBook.totalCopies || 0) -
        (existingBook.availableCopies || 0)

      if (total < borrowedCopies) {
        return res.status(400).json({
          message: 'Total copies cannot be less than borrowed copies',
        })
      }

      updates.totalCopies = total
      updates.availableCopies = total - borrowedCopies
    }

    const result = await books().updateOne(
      { _id: new ObjectId(id) },
      { $set: updates }
    )

    if (result.matchedCount === 0) {
      return res.status(404).json({
        message: 'Book not found',
      })
    }

    const updatedBook = await books().findOne({
      _id: new ObjectId(id),
    })

    res.json({
      message: 'Book updated successfully',
      book: updatedBook,
    })
  } catch (error) {
    handleError(res, error)
  }
})

app.delete('/books/:id', async (req, res) => {
  try {
    const { id } = req.params

    if (!isValidId(id)) {
      return res.status(400).json({
        message: 'Invalid book ID',
      })
    }

    const book = await books().findOne({
      _id: new ObjectId(id),
    })

    if (!book) {
      return res.status(404).json({
        message: 'Book not found',
      })
    }

    const activeBorrows = await borrows().countDocuments({
      bookId: id,
    })

    if (activeBorrows > 0) {
      return res.status(409).json({
        message: 'Cannot delete a book while it has active borrows',
      })
    }

    await books().deleteOne({
      _id: new ObjectId(id),
    })

    res.json({
      message: 'Book deleted successfully',
    })
  } catch (error) {
    handleError(res, error)
  }
})

app.post('/borrows', verifyToken, async (req, res) => {
  const session = client.startSession()

  try {
    const { bookId, userEmail, userName, returnDate } = req.body

    if (!bookId || !userEmail) {
      return res.status(400).json({
        message: 'Book ID and user email are required',
      })
    }

    if (!returnDate) {
      return res.status(400).json({
        message: 'Return date is required',
      })
    }

    if (!isValidId(bookId)) {
      return res.status(400).json({
        message: 'Invalid book ID',
      })
    }

    const existingBorrow = await borrows().findOne({
      bookId,
      userEmail,
    })

    if (existingBorrow) {
      return res.status(409).json({
        message: 'You have already borrowed this book',
      })
    }

    const book = await books().findOneAndUpdate(
      {
        _id: new ObjectId(bookId),
        availableCopies: { $gt: 0 },
      },
      {
        $inc: { availableCopies: -1 },
      },
      {
        returnDocument: 'after',
      }
    )

    if (!book) {
      const existingBook = await books().findOne({
        _id: new ObjectId(bookId),
      })

      if (!existingBook) {
        return res.status(404).json({
          message: 'Book not found',
        })
      }

      return res.status(400).json({
        message: 'No copies available for borrowing',
      })
    }

    const borrowRecord = {
      bookId,
      bookTitle: book.title,
      bookImage: book.image || '',
      userEmail,
      userName: userName || '',
      borrowedAt: new Date(),
      returnDate: new Date(returnDate),
    }

    try {
      const result = await borrows().insertOne(borrowRecord)

      return res.status(201).json({
        message: 'Book borrowed successfully',
        borrow: {
          ...borrowRecord,
          _id: result.insertedId,
        },
      })
    } catch (insertError) {
      
      await books().updateOne(
        { _id: new ObjectId(bookId) },
        { $inc: { availableCopies: 1 } }
      )

      throw insertError
    }
  } catch (error) {
    handleError(res, error)
  } finally {
    await session.endSession()
  }
})

app.get('/borrows', verifyToken, async (req, res) => {
  try {
    const { email } = req.query

    if (!email) {
      return res.status(400).json({
        message: 'User email is required',
      })
    }

    const result = await borrows()
      .find({ userEmail: email })
      .sort({ borrowedAt: -1 })
      .toArray()

    res.json(result)
  } catch (error) {
    handleError(res, error)
  }
})

app.delete('/borrows/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params

    if (!isValidId(id)) {
      return res.status(400).json({
        message: 'Invalid borrow ID',
      })
    }

    const borrowRecord = await borrows().findOne({
      _id: new ObjectId(id),
    })

    if (!borrowRecord) {
      return res.status(404).json({
        message: 'Borrow record not found',
      })
    }

    const bookObjectId = isValidId(borrowRecord.bookId)
      ? new ObjectId(borrowRecord.bookId)
      : null

    if (bookObjectId) {
      const updateResult = await books().updateOne(
        { _id: bookObjectId },
        { $inc: { availableCopies: 1 } }
      )

      if (updateResult.matchedCount === 0) {
        return res.status(409).json({
          message:
            'The original book no longer exists. Borrow record was not removed.',
        })
      }
    }

    await borrows().deleteOne({
      _id: new ObjectId(id),
    })

    res.json({
      message: 'Book returned successfully',
    })
  } catch (error) {
    handleError(res, error)
  }
})