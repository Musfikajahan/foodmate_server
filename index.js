const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

// Middleware
const corsOptions = {
    origin: [
        'http://localhost:5173',
        'http://localhost:5000',
        'https://foodmate-2d2d9.web.app',
        'https://foodshare-gamma.vercel.app'
    ],
    credentials: true,
    optionSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());

// MongoDB Connection Setup
const uri = process.env.MONGO_URI;
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        const db = client.db("foodchefDB");
        const usersCollection = db.collection("users");
        const mealsCollection = db.collection("meals");
        const reviewsCollection = db.collection("reviews");
        const ordersCollection = db.collection("orders");
        const paymentsCollection = db.collection("payments");

        // --- JWT Middleware ---
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
            res.send({ token });
        })

        const verifyToken = (req, res, next) => {
            if (!req.headers.authorization) {
                return res.status(401).send({ message: 'unauthorized access' });
            }
            const token = req.headers.authorization.split(' ')[1];
            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                if (err) {
                    return res.status(401).send({ message: 'unauthorized access' });
                }
                req.decoded = decoded;
                next();
            })
        }

        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            const isAdmin = user?.role === 'admin';
            if (!isAdmin) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();
        }

        // --- USERS API ---
        app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        });

        app.get('/users/profile/:email', async (req, res) => {
            const email = req.params.email;
            const result = await usersCollection.findOne({ email });
            res.send(result);
        });

        app.patch('/users/profile/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            if (email !== req.decoded.email) return res.status(403).send({ message: 'forbidden access' });
            const { name, photoURL, address } = req.body;
            const result = await usersCollection.updateOne({ email }, {
                $set: { name, image: photoURL, address }
            });
            res.send(result);
        });

        app.post('/users', async (req, res) => {
            const user = req.body;
            const existingUser = await usersCollection.findOne({ email: user.email });
            if (existingUser) return res.send({ message: 'user already exists', insertedId: null });
            const result = await usersCollection.insertOne(user);
            res.send(result);
        });

        app.patch('/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const result = await usersCollection.updateOne({ _id: new ObjectId(id) }, {
                $set: { role: req.body.role, status: 'active', requestedRole: null }
            });
            res.send(result);
        });

        app.post('/users/request-role', async (req, res) => {
            const { email, requestedRole } = req.body;
            const result = await usersCollection.updateOne({ email }, {
                $set: { status: 'requested', requestedRole }
            });
            res.send(result);
        });

        app.get('/users/admin/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            if (email !== req.decoded.email) return res.status(403).send({ message: 'forbidden access' });
            const user = await usersCollection.findOne({ email });
            res.send({ isAdmin: user?.role === 'admin' });
        });

        app.get('/users/chef/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            if (email !== req.decoded.email) return res.status(403).send({ message: 'forbidden access' });
            const user = await usersCollection.findOne({ email });
            res.send({ isChef: user?.role === 'chef' });
        });

        // --- MEALS API (FIXED FOR SEARCH) ---
        
        // 1. Get Meals with Search & Pagination
        app.get('/meals', async (req, res) => {
            const page = parseInt(req.query.page) || 0;
            const limit = parseInt(req.query.limit) || 100;
            const search = req.query.search || ""; 
            const skip = page * limit;

            let query = {};
            if (search) {
                // ✅ FIX: Search in 'title' OR 'name' to find both new and old items
                query = {
                    $or: [
                        { title: { $regex: search, $options: 'i' } },
                        { name: { $regex: search, $options: 'i' } },
                        { category: { $regex: search, $options: 'i' } }
                    ]
                };
            }

            const result = await mealsCollection.find(query).skip(skip).limit(limit).toArray();
            res.send(result);
        });

        // 2. Get Count for Pagination
        app.get('/mealsCount', async (req, res) => {
            const search = req.query.search || "";
            let query = {};
            if (search) {
                query = {
                    $or: [
                        { title: { $regex: search, $options: 'i' } },
                        { name: { $regex: search, $options: 'i' } },
                        { category: { $regex: search, $options: 'i' } }
                    ]
                };
            }
            const count = await mealsCollection.countDocuments(query);
            res.send({ count });
        });

        app.get('/meals/:id', async (req, res) => {
            const id = req.params.id;
            const result = await mealsCollection.findOne({ _id: new ObjectId(id) });
            res.send(result);
        });

        app.post('/meals', verifyToken, async (req, res) => {
            const item = req.body;
            const result = await mealsCollection.insertOne(item);
            res.send(result);
        });

        app.get('/meals/chef/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            const result = await mealsCollection.find({ chefEmail: email }).toArray();
            res.send(result);
        });

        app.delete('/meals/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const result = await mealsCollection.deleteOne({ _id: new ObjectId(id) });
            res.send(result);
        });

        app.patch('/meals/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const item = req.body;
            const result = await mealsCollection.updateOne({ _id: new ObjectId(id) }, {
                $set: { title: item.title, category: item.category, price: item.price, description: item.description, image: item.image }
            });
            res.send(result);
        });

        // --- ORDERS API ---
        app.get('/orders', async (req, res) => {
            const email = req.query.email;
            const result = await ordersCollection.find({ userEmail: email }).toArray();
            res.send(result);
        });

        app.get('/orders/:id', verifyToken, async(req, res) => {
            const id = req.params.id;
            const result = await ordersCollection.findOne({ _id: new ObjectId(id) });
            res.send(result);
        });
        
        app.get('/orders/chef/:email', verifyToken, async(req, res) => {
            const email = req.params.email;
            if (email !== req.decoded.email) return res.status(403).send({ message: 'forbidden access' });
            const result = await ordersCollection.find({ chefId: email }).toArray();
            res.send(result);
        });

        app.post('/orders', async (req, res) => {
            const order = req.body;
            order.orderTime = new Date();
            order.orderStatus = "pending";
            const result = await ordersCollection.insertOne(order);
            res.send(result);
        });
        
        app.patch('/orders/status/:id', verifyToken, async(req, res) => {
            const id = req.params.id;
            const { status } = req.body;
            const result = await ordersCollection.updateOne({ _id: new ObjectId(id) }, {
                $set: { orderStatus: status }
            });
            res.send(result);
        });

        app.delete('/orders/:id', async (req, res) => {
            const id = req.params.id;
            const result = await ordersCollection.deleteOne({ _id: new ObjectId(id) });
            res.send(result);
        });

        app.post('/create-payment-intent', async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount, currency: 'usd', payment_method_types: ['card']
            });
            res.send({ clientSecret: paymentIntent.client_secret });
        });

        app.post('/payments', async (req, res) => {
            const payment = req.body;
            const paymentResult = await paymentsCollection.insertOne(payment);
            const updatedDoc = { $set: { paymentStatus: 'paid', orderStatus: 'paid' } };
            const deleteResult = await ordersCollection.updateOne({ _id: new ObjectId(payment.orderId) }, updatedDoc);
            res.send({ paymentResult, deleteResult });
        });

        app.get('/payments/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            if (email !== req.decoded.email) return res.status(403).send({ message: 'forbidden access' });
            const result = await paymentsCollection.find({ email }).toArray();
            res.send(result);
        });
        
        app.get('/payments', verifyToken, verifyAdmin, async (req, res) => {
            const result = await paymentsCollection.find().toArray();
            res.send(result);
        });

        // --- REVIEWS API ---
        app.get('/reviews', async (req, res) => {
            let query = {};
            if (req.query.email) query = { email: req.query.email };
            const result = await reviewsCollection.find(query).sort({ date: -1 }).toArray();
            res.send(result);
        });

        app.post('/reviews', verifyToken, async (req, res) => {
            const review = req.body;
            const result = await reviewsCollection.insertOne(review);
            const mealReviews = await reviewsCollection.find({ mealId: review.mealId }).toArray();
            const count = mealReviews.length;
            const totalRating = mealReviews.reduce((sum, r) => sum + r.rating, 0);
            const average = count > 0 ? totalRating / count : 0;
            await mealsCollection.updateOne({ _id: new ObjectId(review.mealId) }, {
                $set: { rating: average, reviews_count: count }, $inc: { likes: 1 }
            });
            res.send(result);
        });

    } finally {
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => { res.send('FoodMate Server is Running'); })
app.listen(port, () => { console.log(`FoodMate is sitting on port ${port}`); })