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


