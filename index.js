import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { MongoClient, ObjectId } from 'mongodb'
import jwt from 'jsonwebtoken'
import { betterAuth } from 'better-auth'
import { mongodbAdapter } from 'better-auth/adapters/mongodb'
import { fromNodeHeaders } from 'better-auth/node'

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
let backendAuth

const JWT_SECRET = process.env.JWT_SECRET

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is missing from the .env file')
}

// Database connection
async function connectDB() {
  try {
    await client.connect()

    db = client.db('booknook')

    await db.command({ ping: 1 })

  
backendAuth = betterAuth({
  database: mongodbAdapter(db),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',

  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
  },

  session: {
    cookieCache: {
      enabled: true,
      maxAge: 60 * 60 * 24 * 7,
    },
  },
})
    await borrows().createIndex(
      { bookId: 1, userEmail: 1 },
      { unique: true, name: 'unique_book_user_borrow' }
    )

    console.log('Connected to MongoDB Atlas successfully!')
  } catch (error) {
    console.error('MongoDB connection error:', error.message)
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
  return (
    typeof id === 'string' &&
    ObjectId.isValid(id) &&
    String(new ObjectId(id)) === id
  )
}

function handleError(res, error) {
  console.error(error)

  return res.status(500).json({
    message: 'Internal server error',
  })
}

// JWT verification middleware
function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      message: 'Unauthorized: No token provided',
    })
  }

  const token = authHeader.split(' ')[1]

  try {
    const decoded = jwt.verify(token, JWT_SECRET)

    if (
      typeof decoded === 'string' ||
      !decoded.email ||
      typeof decoded.email !== 'string'
    ) {
      return res.status(403).json({
        message: 'Forbidden: Invalid token payload',
      })
    }

    req.user = decoded

    next()
  } catch {
    return res.status(403).json({
      message: 'Forbidden: Invalid or expired token',
    })
  }
}

// Check that the request belongs to the authenticated user.
function verifyUserEmail(req, res, email) {
  if (
    typeof email !== 'string' ||
    email.trim().toLowerCase() !==
      req.user.email.trim().toLowerCase()
  ) {
    res.status(403).json({
      message: 'You can only access your own account data',
    })

    return false
  }

  return true
}

// Health check
app.get('/', (req, res) => {
  res.json({
    message: 'BookNook API is running!',
    status: 'OK',
  })
})

// JWT endpoint
// IMPORTANT: This endpoint alone does not authenticate a real user.
// Connect it to your actual authentication provider before production.
// Generate JWT after verifying Better Auth session
app.post('/jwt', async (req, res) => {
  try {
    const session = await backendAuth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    })

    if (!session || !session.user) {
      return res.status(401).json({
        message: 'Unauthorized: Please login first',
      })
    }

    const token = jwt.sign(
      {
        email: session.user.email.toLowerCase(),
        userId: session.user.id,
      },
      JWT_SECRET,
      {
        expiresIn: '7d',
      }
    )

    return res.json({ token })
  } catch (error) {
    console.error('JWT generation error:', error)

    return res.status(500).json({
      message: 'Could not generate JWT',
    })
  }
})

// Get all books
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

// Get a single book
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

// Add a book
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

// Update a book
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

    const bookId = new ObjectId(id)

    if (updates.totalCopies !== undefined) {
      const total = Number(updates.totalCopies)

      if (!Number.isInteger(total) || total < 1) {
        return res.status(400).json({
          message: 'Total copies must be a positive integer',
        })
      }

      const existingBook = await books().findOne({
        _id: bookId,
      })

      if (!existingBook) {
        return res.status(404).json({
          message: 'Book not found',
        })
      }

      const borrowedCopies =
        (existingBook.totalCopies ?? 0) -
        (existingBook.availableCopies ?? 0)

      if (total < borrowedCopies) {
        return res.status(400).json({
          message: 'Total copies cannot be less than borrowed copies',
        })
      }

      updates.totalCopies = total
      updates.availableCopies = total - borrowedCopies
    }

    const result = await books().updateOne(
      { _id: bookId },
      { $set: updates }
    )

    if (result.matchedCount === 0) {
      return res.status(404).json({
        message: 'Book not found',
      })
    }

    const updatedBook = await books().findOne({
      _id: bookId,
    })

    res.json({
      message: 'Book updated successfully',
      book: updatedBook,
    })
  } catch (error) {
    handleError(res, error)
  }
})

// Delete a book
app.delete('/books/:id', async (req, res) => {
  try {
    const { id } = req.params

    if (!isValidId(id)) {
      return res.status(400).json({
        message: 'Invalid book ID',
      })
    }

    const bookId = new ObjectId(id)

    const book = await books().findOne({
      _id: bookId,
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
      _id: bookId,
    })

    res.json({
      message: 'Book deleted successfully',
    })
  } catch (error) {
    handleError(res, error)
  }
})

// Borrow a book
app.post('/borrows', verifyToken, async (req, res) => {
  const session = client.startSession()

  try {
    const { bookId, userEmail, userName, returnDate } = req.body

    if (!bookId || !userEmail) {
      return res.status(400).json({
        message: 'Book ID and user email are required',
      })
    }

    // Ensure that the request email matches the JWT email.
    if (!verifyUserEmail(req, res, userEmail)) {
      return
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

    const parsedReturnDate = new Date(returnDate)

    if (Number.isNaN(parsedReturnDate.getTime())) {
      return res.status(400).json({
        message: 'Invalid return date',
      })
    }

    const bookObjectId = new ObjectId(bookId)
    let borrowRecord

    await session.withTransaction(async () => {
      const existingBorrow = await borrows().findOne(
        { bookId, userEmail: req.user.email },
        { session }
      )

      if (existingBorrow) {
        const error = new Error('You have already borrowed this book')
        error.statusCode = 409
        throw error
      }

      const book = await books().findOneAndUpdate(
        {
          _id: bookObjectId,
          availableCopies: { $gt: 0 },
        },
        {
          $inc: { availableCopies: -1 },
        },
        {
          returnDocument: 'after',
          session,
        }
      )

      if (!book) {
        const existingBook = await books().findOne(
          { _id: bookObjectId },
          { session }
        )

        if (!existingBook) {
          const error = new Error('Book not found')
          error.statusCode = 404
          throw error
        }

        const error = new Error('No copies available for borrowing')
        error.statusCode = 400
        throw error
      }

      borrowRecord = {
        bookId,
        bookTitle: book.title,
        bookImage: book.image || '',
        userEmail: req.user.email,
        userName: userName || '',
        borrowedAt: new Date(),
        returnDate: parsedReturnDate,
      }

      const result = await borrows().insertOne(borrowRecord, {
        session,
      })

      borrowRecord._id = result.insertedId
    })

    res.status(201).json({
      message: 'Book borrowed successfully',
      borrow: borrowRecord,
    })
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: 'You have already borrowed this book',
      })
    }

    if (error.statusCode) {
      return res.status(error.statusCode).json({
        message: error.message,
      })
    }

    handleError(res, error)
  } finally {
    await session.endSession()
  }
})

// Get borrow records for the authenticated user
app.get('/borrows', verifyToken, async (req, res) => {
  try {
    const { email } = req.query

    if (!email) {
      return res.status(400).json({
        message: 'User email is required',
      })
    }

    if (!verifyUserEmail(req, res, email)) {
      return
    }

    const result = await borrows()
      .find({ userEmail: req.user.email })
      .sort({ borrowedAt: -1 })
      .toArray()

    res.json(result)
  } catch (error) {
    handleError(res, error)
  }
})

// Return a book
app.delete('/borrows/:id', verifyToken, async (req, res) => {
  const session = client.startSession()

  try {
    const { id } = req.params

    if (!isValidId(id)) {
      return res.status(400).json({
        message: 'Invalid borrow ID',
      })
    }

    const borrowId = new ObjectId(id)

    await session.withTransaction(async () => {
      // Find only a borrow record owned by the authenticated user.
      const borrowRecord = await borrows().findOne(
        {
          _id: borrowId,
          userEmail: req.user.email,
        },
        { session }
      )

      if (!borrowRecord) {
        const error = new Error(
          'Borrow record not found for your account'
        )
        error.statusCode = 404
        throw error
      }

      if (!isValidId(borrowRecord.bookId)) {
        const error = new Error(
          'The original book ID is invalid. Borrow record was not removed.'
        )
        error.statusCode = 409
        throw error
      }

      const bookObjectId = new ObjectId(borrowRecord.bookId)

      // Do not increase copies beyond the book's total copies.
      const updateResult = await books().updateOne(
        {
          _id: bookObjectId,
          $expr: {
            $lt: ['$availableCopies', '$totalCopies'],
          },
        },
        {
          $inc: { availableCopies: 1 },
        },
        { session }
      )

      if (updateResult.matchedCount === 0) {
        const error = new Error(
          'The original book is missing or its copy count is inconsistent.'
        )
        error.statusCode = 409
        throw error
      }

      // Delete only this user's borrow record.
      const deleteResult = await borrows().deleteOne(
        {
          _id: borrowId,
          userEmail: req.user.email,
        },
        { session }
      )

      if (deleteResult.deletedCount !== 1) {
        const error = new Error(
          'Borrow record could not be returned. Please try again.'
        )
        error.statusCode = 409
        throw error
      }
    })

    res.json({
      message: 'Book returned successfully',
    })
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        message: error.message,
      })
    }

    handleError(res, error)
  } finally {
    await session.endSession()
  }
})

// Get books added by the authenticated user
app.get('/my-books', verifyToken, async (req, res) => {
  try {
    const { email } = req.query

    if (!email) {
      return res.status(400).json({
        message: 'User email is required',
      })
    }

    if (!verifyUserEmail(req, res, email)) {
      return
    }

    const result = await books()
      .find({ userEmail: req.user.email })
      .sort({ _id: -1 })
      .toArray()

    res.json(result)
  } catch (error) {
    handleError(res, error)
  }
})

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    message: 'Route not found',
  })
})

// Start server after connecting to the database and creating the index.
connectDB().then(() => {
  app.listen(port, () => {
    console.log(`BookNook server running on port ${port}`)
  })
})
