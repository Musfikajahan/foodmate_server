const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
// ✅ Ensure Stripe is initialized
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
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
        const ordersCollection = db.collection("orders");
        const paymentsCollection = db.collection("payments");

        // Helper function to fix missing names in data
        const fixMealData = (meal) => {
            if (!meal) return meal;
            meal.name = meal.name || meal.Name || meal.recipeName || meal.title || meal.itemName || "Unnamed Item";
            if (meal.price && typeof meal.price === 'string') {
                meal.price = parseFloat(meal.price);
            }
            return meal;
        };

        // --- USERS ---
        app.get('/users', async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        });

        app.post('/users', async (req, res) => {
            const user = req.body;
            const exists = await usersCollection.findOne({ email: user.email });
            if (exists) return res.send({ message: 'User exists', insertedId: null });
            const result = await usersCollection.insertOne(user);
            res.send(result);
        });

        app.patch('/users/admin/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = { $set: { role: req.body.role } };
            const result = await usersCollection.updateOne(filter, updatedDoc);
            res.send(result);
        });

        // --- MEALS ---
        app.get('/meals', async (req, res) => {
            const meals = await mealsCollection.find().toArray();
            const fixedMeals = meals.map(fixMealData);
            res.send(fixedMeals);
        });

        app.get('/meals/:id', async (req, res) => {
            const id = req.params.id;
            let result = null;
            try {
                if (ObjectId.isValid(id)) {
                    result = await mealsCollection.findOne({ _id: new ObjectId(id) });
                }
                if (!result) {
                    result = await mealsCollection.findOne({
                        $or: [{ id: id }, { id: parseInt(id) }, { _id: id }]
                    });
                }
                if (!result) return res.status(404).send({ message: "Meal not found" });
                res.send(fixMealData(result));
            } catch (error) {
                console.error("Error fetching meal:", error);
                res.status(500).send({ message: "Internal Server Error" });
            }
        });

        app.get('/meals/chef/:email', async (req, res) => {
            const email = req.params.email;
            const query = { chefEmail: email };
            const result = await mealsCollection.find(query).toArray();
            const fixedMeals = result.map(fixMealData);
            res.send(fixedMeals);
        });

        app.post('/meals', async (req, res) => {
            const newMeal = req.body;
            const result = await mealsCollection.insertOne(newMeal);
            res.send(result);
        });

        // --- ROLES ---
        app.get('/users/admin/:email', async (req, res) => {
            const email = req.params.email;
            const user = await usersCollection.findOne({ email });
            if (!user) return res.send({ isAdmin: false });
            res.send({ isAdmin: user.role === "admin" });
        });

        app.get('/users/chef/:email', async (req, res) => {
            const email = req.params.email;
            const user = await usersCollection.findOne({ email });
            if (!user) return res.send({ isChef: false });
            res.send({ isChef: user.role === "chef" });
        });

        // --- ORDERS ---
        app.post('/orders', async (req, res) => {
            const order = req.body;
            order.orderTime = new Date();
            order.orderStatus = "pending";
            const result = await ordersCollection.insertOne(order);
            res.send(result);
        });

        app.get('/orders', async (req, res) => {
            const email = req.query.email;
            if (!email) return res.send([]);
            let orders = await ordersCollection.find({ userEmail: email }).toArray();
            orders = await Promise.all(orders.map(async (order) => {
                if (!order.name || order.name === "Unknown Item" || order.name === "Unnamed Item") {
                    const mealId = order.menuId || order.mealId || order.id;
                    if (mealId) {
                        let meal = null;
                        if (ObjectId.isValid(mealId)) {
                            meal = await mealsCollection.findOne({ _id: new ObjectId(mealId) });
                        }
                        if (!meal) {
                            meal = await mealsCollection.findOne({
                                $or: [{ id: mealId }, { id: parseInt(mealId) }, { _id: mealId }]
                            });
                        }
                        if (meal) {
                            const fixedMeal = fixMealData(meal);
                            order.name = fixedMeal.name;
                            order.image = fixedMeal.image;
                            order.price = fixedMeal.price;
                        }
                    }
                }
                return order;
            }));
            res.send(orders);
        });

        app.get('/orders/:id', async (req, res) => {
            const id = req.params.id;
            try {
                if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid Order ID" });
                const result = await ordersCollection.findOne({ _id: new ObjectId(id) });
                if (!result) return res.status(404).send({ message: "Order not found" });
                res.send(result);
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: "Error fetching order" });
            }
        });

        app.get('/orders/chef/:email', async (req, res) => {
            const email = req.params.email;
            const orders = await ordersCollection.find({ chefEmail: email }).sort({ orderTime: -1 }).toArray();
            res.send(orders);
        });

        app.delete('/orders/:id', async (req, res) => {
            const id = req.params.id;
            const result = await ordersCollection.deleteOne({ _id: new ObjectId(id) });
            res.send(result);
        });

        app.patch('/orders/status/:id', async (req, res) => {
            const id = req.params.id;
            const { status } = req.body;
            const result = await ordersCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { orderStatus: status } }
            );
            res.send(result);
        });

        // --- PAYMENTS & STRIPE ---

        // ✅ FIXED: ADDED THIS MISSING ROUTE
        app.post('/create-payment-intent', async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100); // Convert dollars to cents
            
            console.log("Creating payment intent for amount (cents):", amount); // Debug log

            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });

            res.send({
                clientSecret: paymentIntent.client_secret
            });
        });

        app.post('/payments', async (req, res) => {
            const payment = req.body;
            await ordersCollection.updateOne(
                { _id: new ObjectId(payment.orderId) },
                { $set: { orderStatus: "paid", paymentStatus: "paid" } }
            );
            const result = await paymentsCollection.insertOne(payment);
            res.send({ paymentResult: result });
        });

        app.get('/payments/:email', async (req, res) => {
            const email = req.params.email;
            const payments = await paymentsCollection.find({ email }).sort({ date: -1 }).toArray();
            res.send(payments);
        });

        await client.db("admin").command({ ping: 1 });
        console.log("MongoDB connected!");

        app.listen(port, () => {
            console.log(`Server is running on port ${port}`);
        });

    } finally {
        // Keep connection open
    }
}
run().catch(console.dir);