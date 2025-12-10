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
