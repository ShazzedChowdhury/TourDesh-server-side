const dotenv = require("dotenv");
dotenv.config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const Stripe = require("stripe");
const {
  MongoClient,
  ServerApiVersion,
  ObjectId,
  ChangeStream,
} = require("mongodb");

const app = express();
const PORT = process.env.PORT || 5000;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const allowedOrigins = [
  "http://localhost:5173",
  "https://tourdesh-project-client.web.app", // your frontend deploy URL
];

// Middleware
app.use(cors({
  origin: allowedOrigins,
  methods: ["GET","POST", "DELETE", "PATCH", "OPTIONS"],
  credentials: true
}));
app.use(express.json());

//custom middleware
const verifyJWT = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).send({ message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  //verify the token
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      res.status(403).send({ message: "Forbidden" });
    }

    req.user = decoded;
    next();
  });
};


// MongoDB Connection
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

var admin = require("firebase-admin");

var serviceAccount = JSON.parse(
  Buffer.from(process.env.FIREBASE_SERVICE_KEY, "base64").toString("utf8")
);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const JWT_SECRET = process.env.JWT_SECRET;

async function run() {
  try {
    const db = client.db("TourDeshDB");
    const usersCollection = db.collection("users");
    const applicationsCollection = db.collection("Applications");
    const paymentsCollection = db.collection("Payments");
    const packagesCollection = db.collection("packages");
    const storiesCollection = db.collection("Stories");
    const bookingsCollection = db.collection("Bookings");
    const blogsCollection = db.collection("Blogs");
    const reviewsCollection = db.collection("Reviews");

    // const verifyAdmin = async (req, res, next) => {
    //   const user = await usersCollection.findOne({
    //     email: req.firebaseUser.email,
    //   });

    //   if (user.role === "admin") {
    //     next();
    //   } else {
    //     res.status(403).send({ msg: "unauthorized" });
    //   }
    // };

    // Verify Firebase token & issue custom JWT
    app.post("/jwt", async (req, res) => {
      const { idToken } = req.body;

      try {
        // Verify Firebase token
        const decoded = await admin.auth().verifyIdToken(idToken);

        //get the user from user collection by email
        const user = await usersCollection.findOne({ email: decoded.email });

        // Example payload (you can add role later)
        const payload = {
          uid: decoded.uid,
          name: decoded.name,
          email: decoded.email,
          role: user.role,
        };

        // Create custom JWT
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });

        res.json({ token });
      } catch (error) {
        console.error("JWT creation error:", error);
        res.status(401).json({ message: "Invalid Firebase token" });
      }
    });

    // 1. Create PaymentIntent
    app.post("/create-payment-intent", async (req, res) => {
      try {
        const { price } = req.body;
        const amount = Math.round(price * 100); // cents
      
        const paymentIntent = await stripe.paymentIntents.create({
          amount,
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Payment Intent creation failed" });
      }
    });

    // 2. Record payment and update booking
    app.post("/confirm-payment", async (req, res) => {
      try {
        const { bookingId, transactionId, paymentBy, amount, packageId } =
          req.body;

        // Save payment info
        const paymentInfo = {
          bookingId,
          packageId,
          paymentBy,
          amount,
          transactionId,
          createdAt: new Date(),
        };

        //inset the payment info into the database
        await paymentsCollection.insertOne(paymentInfo);

        // Update booking status
        await bookingsCollection.updateOne(
          { _id: new ObjectId(bookingId) },
          { $set: { status: "in review" } }
        );

        res.send({ message: "Payment successful" });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Payment confirmation failed", err });
      }
    });


    //get all payments
    app.get("/payments",verifyJWT, async (req, res) => {
      const payments = await paymentsCollection.find()
        .sort({ createdAt: -1 })
        .toArray();
      res.send(payments);
    });

    // app.get("/payments/:email", verifyJWT, async (req, res) => {
    //   try {
    //     const { email } = req.params; // Logged-in user's email
    //     console.log("user", email)
    //     const payments = await paymentsCollection
    //       .aggregate([
    //         { $match: { paymentBy: email } }, // Only payments by this user
    //         {
    //           $group: {
    //             _id: "$packageId",
    //             totalAmount: { $sum: "$amount" }, // sum of payments per package
    //           },
    //         },
    //         {
    //           $lookup: {
    //             from: "packages",
    //             localField: "_id",
    //             foreignField: "_id",
    //             as: "package",
    //           },
    //         },
    //         { $unwind: "$package" }, // Flatten package array
    //         {
    //           $project: {
    //             _id: 0,
    //             packageId: "$_id",
    //             packageTitle: "$package.title",
    //             packagePrice: "$package.price", // Include package price
    //             totalAmount: 1,
    //           },
    //         },
    //         { $sort: { totalAmount: -1 } }, // Optional: sort by highest payment
    //       ])
    //       .toArray();

    //     res.send( payments );
    //   } catch (err) {
    //     console.error(err);
    //     res.status(500).send({ message: "Failed to fetch user payments", err });
    //   }
    // });

    app.post("/add-user", async (req, res) => {
      const userData = req.body;
      
      const find_result = await usersCollection.findOne({
        email: userData.email,
      });

      if (find_result) {
        return res.send({ msg: "user already exist" });
      } else {
        const result = await usersCollection.insertOne(userData);
        res.send(result);
      }
    });

    app.get("/get-user-role", async (req, res) => {
      try {
        const user = await usersCollection.findOne({
        email: req.query.email,
      });
      res.send({ role: user.role });
      } catch (err) {
        res.status(500).send(err)
      }
    });

   
    //GET user stats
    app.get("/user-stats",verifyJWT, async (req, res) => {
      try {
        const {email} = req.user;
   
       const totalPayment = await paymentsCollection
         .aggregate([
           {
             $match: {
               paymentBy: email,
             }, // filter by specific email
           },
           {
             $group: {
               _id: null, // no grouping key needed since it's one user
               sum: { $sum: "$amount" }, // sum the amount
             },
           },
         ])
         .toArray();
        const totalPending = await bookingsCollection.countDocuments({
          status: "pending",
        });
        const totalAccepted = await bookingsCollection.countDocuments({
          status: "accepted",
        });
        const totalStories = await storiesCollection.countDocuments({
          addedBy: email,
        });

        res.send({
          totalPayment: totalPayment[0]?.sum || 0,
          totalPending,
          totalAccepted,
          totalStories,
        });
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch admin stats", err });
      }
    });
    //GET admin stats
    app.get("/admin-stats",verifyJWT, async (req, res) => {
      try {
        const totalPayment = await paymentsCollection
          .aggregate([{ $group: { _id: null, sum: { $sum: "$amount" } } }])
          .toArray();
        const totalGuides = await usersCollection.countDocuments({
          role: "tour guide",
        });
        const totalClients = await usersCollection.countDocuments({
          role: "tourist",
        });
        const totalPackages = await packagesCollection.estimatedDocumentCount();
        const totalStories = await storiesCollection.estimatedDocumentCount();

        res.send({
          totalPayment: totalPayment[0]?.sum || 0,
          totalGuides,
          totalClients,
          totalPackages,
          totalStories,
        });
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch admin stats", err });
      }
    });

    // GET /overview
    app.get("/overview", async (req, res) => {
      try {
        const totalPackages = await packagesCollection.countDocuments();
        const totalGuides = await usersCollection.countDocuments({
          role: "tour guide",
        });
        const totalStories = await storiesCollection.countDocuments();
        const totalClients = await usersCollection.countDocuments({
          role: "tourist",
        });

        res.send({ totalPackages, totalGuides, totalStories, totalClients });
      } catch (err) {
        res.status(500).send({ message: err.message });
      }
    });

    // GET /users?search=keyword
    app.get("/users", verifyJWT, async (req, res) => {
      try {
        const search = req.query.search || "";
        const role = req.query.role; // new role filter
        const skipEmail = req.user.email;
        const page = parseInt(req.query.page);
        const limit = parseInt(req.query.limit);

       
        // Build the query
        const query = {
          email: { $ne: skipEmail },
          $or: [
            { userName: { $regex: search, $options: "i" } },
            { email: { $regex: search, $options: "i" } },
          ],
        };

        // If role filter is provided and not 'all', add to query
        if (role && role !== "all") {
          query.role = role;
        }

        const totalDocs = await usersCollection.countDocuments(query);
        const users = await usersCollection.find(query).skip((page - 1) * limit).limit(limit).toArray();

        res.send({
          users,
          page,
          pages:  Math.ceil(totalDocs / limit)
        });
      } catch (err) {
        res.status(500).send({ message: err.message });
      }
    });

    // Get random guides (role = "tour guide")
    app.get("/users/random-guides", async (req, res) => {
      const limit = parseInt(req.query.limit) || 6;
      const result = await usersCollection
        .aggregate([
          { $match: { role: "tour guide" } },
          { $sample: { size: limit } },
        ])
        .toArray();
      res.send(result);
    });

    //GET a specific user
    app.get("/users/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const result = await usersCollection.findOne({ _id: new ObjectId(id) });
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: err.massage });
      }
    });

    app.get("/get-tour-guides", async (req, res) => {
      try {
        const result = await usersCollection
          .find({ role: "tour guide" })
          .toArray();
        res.send(result);
      } catch (err) {
        res
          .status(500)
          .res.send({ message: "Failed to fetch tour guide", err });
      }
    });

    //Get all applications
    app.get("/applications", verifyJWT, async (req, res) => {
      try {
        const page = parseInt(req.query.page);
        const limit = parseInt(req.query.limit);

        const totalDocs = await applicationsCollection.estimatedDocumentCount();
        const applications = await applicationsCollection
          .aggregate([
            {
              $lookup: {
                from: "users", // users collection
                localField: "email", // email in applications
                foreignField: "email", // email in users
                as: "userInfo", // result array
              },
            },
            {
              $unwind: {
                path: "$userInfo",
                preserveNullAndEmptyArrays: true, // in case user not found
              },
            },
            {
              $addFields: {
                role: "$userInfo.role", // add role field
                email: "$userInfo.email", // add email field
              },
            },
            {
              $project: {
                userInfo: 0, // remove the extra joined object
              },
            },
          ])
          .skip((page -1) * limit)
          .limit(limit)
          .toArray();

        res
        .status(200)
        .send({
          applications,
          page,
          pages: Math.ceil( totalDocs / limit )
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: error.message,
        });
      }
    });

    // POST /applications -> create new application (Tourist api)
    app.post("/applications", async (req, res) => {
      try {
        const {
          title,
          reason,
          cvLink,
          applicantEmail,
          photoURL,
          applicantName,
          appliedAt,
        } = req.body;

        // if (!title || !reason || !cvLink || !email || !displayName) {
        //   return res.status(400).json({ message: "Missing required fields" });
        // }

        const newApplication = {
          title,
          reason,
          cvLink,
          applicantEmail,
          photoURL,
          applicantName,
          appliedAt: appliedAt || new Date().toISOString(),
        };

        const result = await applicationsCollection.insertOne(newApplication);
        res.status(201).send(result);
      } catch (error) {
        console.error("Error inserting application:", error);
        res.status(500).json({ message: "Failed to submit application" });
      }
    });

    //GET all packages
    app.get("/packages", async (req, res) => {
      try {
        const {sort} = req.query;

       if(sort) {
         const result = await packagesCollection
           .find()
           .sort({ price: parseInt(sort) })
           .toArray();
           res.send(result);
       }

        const result = await packagesCollection
          .find()
          .toArray();
          res.send(result);
      } catch (err) {
        res.status(500).send({ message: err.message });
      }
    });
    // Get random packages (limit passed in query)
    app.get("/packages/random", async (req, res) => {
      const limit = parseInt(req.query.limit) || 3;
      const result = await packagesCollection
        .aggregate([{ $sample: { size: limit } }])
        .toArray();
      res.send(result);
    });

    //GET a specific package by id (admin api)
    app.get("/packages/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const result = await packagesCollection.findOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: err.message });
      }
    });

    //POST package (admin api)
    app.post("/add-package", async (req, res) => {
      try {
        const packageInfo = req.body;
        const result = await packagesCollection.insertOne(packageInfo);
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: err.message });
      }
    });

    // Update user role by email
    app.patch("/users/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const { role } = req.body;

        const result = await usersCollection.updateOne(
          { email },
          { $set: { role } },
          { upsert: false }
        );

        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to update role", err });
      }
    });

    // Update user info by email
    app.patch("/users-info/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const { displayName: userName, photoURL} = req.body.updatedInfo;

        const result = await usersCollection.updateOne(
          { email },
          { $set: {
            userName,
            photoURL
          } },
          { upsert: false }
        );

        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to update user info", err });
      }
    });

    //Delete application by id
    app.delete("/applications/:id", async (req, res) => {
      try {
        const { id } = req.params;

        const result = await applicationsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to delete application", err });
      }
    });

    //GET all stories (tourist and tour guide API)
    app.get("/all-stories", async (req, res) => {
      try {
        const result = await storiesCollection
          .find()
          .sort({ createdAt: 1 })
          .toArray();
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to retrieve stories", err });
      }
    });

    //GET all stories by email (tourist and tour guide API)
    app.get("/stories", async (req, res) => {
      try {
        const query = {};
        const { email } = req.query;

        if (email) {
          query.addedBy = email;
        }

        const result = await storiesCollection
          .find(query)
          .sort({ createdAt: 1 })
          .toArray();

        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to retrieve stories", err });
      }
    });

    //GET random stories by role tourist
    app.get("/stories/random-tourist", async (req, res) => {
      const limit = parseInt(req.query.limit) || 4;
      const result = await storiesCollection
        .aggregate([
          { $match: { role: "tourist" } },
          { $sample: { size: limit } },
        ])
        .toArray();
      res.send(result);
    });

    //GET specific story by id (tourist and tour guide API)
    app.get("/stories/:id", async (req, res) => {
      try {
        const { id } = req.params;

        const result = await storiesCollection.findOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to retrieve stories", err });
      }
    });

    //POST stories (tourist and tour guide api)
    app.post("/stories", async (req, res) => {
      try {
        const storyData = req.body;
        const result = await storiesCollection.insertOne(storyData);
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to insert stories", err });
      }
    });

    // PATCH /stories/:id to update stories (tourist and tour guide API)
    app.patch("/stories/:id", async (req, res) => {
      const { id } = req.params;
      const { title, content } = req.body;

      const result = await storiesCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            title,
            content,
          },
        }
      );
      res.json(result);
    });

    // PATCH /update-stories-img/:id to remove-image and add new image (tourist and tour guide API)
    app.patch("/update-stories-img/:id", async (req, res) => {
      const { id } = req.params;
      const { imgUrl } = req.body;
      let updatedData = null;

      const story = await storiesCollection.findOne({ _id: new ObjectId(id) });

      if (story.images.includes(imgUrl)) {
        updatedData = { $pull: { images: imgUrl } };
      } else {
        updatedData = { $push: { images: imgUrl } };
      }
      const result = await storiesCollection.updateOne(
        { _id: new ObjectId(id) },
        updatedData
      );
      res.json(result);
    });

    //DELETE a spedifc story (tourist and tour guide API)
    app.delete("/stories/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const result = await storiesCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.json(result);
      } catch (error) {
        console.error("Error deleting story:", error);
        res.status(500).json({ message: "Failed to delete story" });
      }
    });

    //GET /bookings to get bookings
    app.get("/bookings", verifyJWT, async (req, res) => {
      try {
        const query = {};
        const { email, guideEmail } = req.query;

        if (email) {
          query.touristEmail = email;
        }
        if (guideEmail) {
          query.guideEmail = guideEmail;
        }
        const result = await bookingsCollection.find(query).toArray();
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch bookings", err });
      }
    });

    //GET /bookings to get a specific booking
    app.get("/bookings/:id", verifyJWT, async (req, res) => {
      try {
        const { id } = req.params;
        const result = await bookingsCollection.findOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch bookings", err });
      }
    });

    //POST /bookings to insert a bookings
    app.post("/bookings", async (req, res) => {
      try {
        const bookings = req.body;
        const result = await bookingsCollection.insertOne(bookings);
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to insert bookings", err });
      }
    });

    // PATCH booking status
    app.patch("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;
      const result = await bookingsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
      );
      res.send(result);
    });

    //DELETE /bookings to delete a booking
    app.delete("/bookings/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const result = await bookingsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to insert bookings", err });
      }
    });

    //blogs related apis
    //GET /blogs route
    app.get("/blogs", async(req, res) => {
      const limit = parseInt(req.query.limit);
      try{
        const result = await blogsCollection.find({}).limit(limit).toArray();
        res.send(result)
      } catch{
        res.status(500).send({message: "Failed to retrieve blogs", err: err.message})
      }
    })
    //GET /reviews route
    app.get("/reviews", async(req, res) => {
      try{
        const result = await reviewsCollection.find({}).toArray();
        res.send(result)
      } catch{
        res.status(500).send({message: "Failed to retrieve reviews", err: err.message})
      }
    })

    console.log("connected");
  } finally {
  }
}

run().catch(console.dir);

// Root route
app.get("/", async (req, res) => {
  res.send("TourDesh server is running.....");
});

app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
