const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);


const app = express();
const port = process.env.PORT || 5000;


// Middleware
app.use(cors());
app.use(express.json());
// MongoDB Connection
const uri = process.env.MONGO_URI;
const client = new MongoClient(uri, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
});


async function run() {
    try {
        const db = client.db("foodchefDB");
        const usersCollection = db.collection("users");
        const mealsCollection = db.collection("meals");
        const ordersCollection = db.collection("orders");
        const paymentsCollection = db.collection("payments");


 // --- Admin creation ---
 app.get('/create-admins', async (req, res) => {
    const admins = [
        { name: "Admin One", email: "admin1@example.com", role: "admin" },
        { name: "Admin Two", email: "admin2@example.com", role: "admin" }
    ];
    const results = [];
    for (const admin of admins) {
        const exists = await usersCollection.findOne({ email: admin.email });
        if (!exists) results.push(await usersCollection.insertOne(admin));
    }
    res.send({ message: "Admins created if not exist", results });
});
 // --- Users ---
 app.post('/users', async (req, res) => {
    const user = req.body;
    const exists = await usersCollection.findOne({ email: user.email });
    if (exists) return res.send({ message: 'User exists', insertedId: null });
    const result = await usersCollection.insertOne(user);
    res.send(result);
});
  // --- Check if user is admin ---
  app.get('/users/admin/:email', async (req, res) => {
    const email = req.params.email;
    const user = await usersCollection.findOne({ email });
    if (!user) return res.status(404).send({ error: "User not found" });
    res.send({ isAdmin: user.role === "admin" });
});
 // --- Orders ---
 app.post('/orders', async (req, res) => {
    const order = req.body;
    order.orderTime = new Date();
    order.orderStatus = "pending";
    const result = await ordersCollection.insertOne(order);
    res.send(result);
});


app.get('/orders', async (req, res) => {
    const email = req.query.email;
    const orders = await ordersCollection.find({ userEmail: email }).toArray();
    res.send(orders);
});


app.get('/orders/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const order = await ordersCollection.findOne({ _id: new ObjectId(id) });
        if (!order) return res.status(404).send({ error: "Order not found" });
        res.send(order);
    } catch (error) {
        res.status(500).send({ error: "Failed to fetch order" });
    }
});


app.get('/orders/chef/:email', async (req, res) => {
    const email = req.params.email;
    const orders = await ordersCollection.find({ chefEmail: email }).sort({ orderTime: -1 }).toArray();
    res.send(orders);
});


app.patch('/orders/status/:id', async (req, res) => {
    const id = req.params.id;
    const { status } = req.body;
    const order = await ordersCollection.findOne({ _id: new ObjectId(id) });
    if (!order) return res.status(404).send({ error: "Order not found" });


    if (order.orderStatus === "paid" || order.orderStatus === "cancelled") {
        return res.status(400).send({ error: "Cannot change status of paid or cancelled order" });
    }


    const result = await ordersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { orderStatus: status } }
    );
    res.send(result);
});


app.delete('/orders/:id', async (req, res) => {
    const id = req.params.id;
    const result = await ordersCollection.deleteOne({ _id: new ObjectId(id) });
    res.send(result);
});
