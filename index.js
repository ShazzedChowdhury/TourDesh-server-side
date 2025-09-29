const dotenv = require("dotenv");
dotenv.config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const {
  MongoClient,
  ServerApiVersion,
  ObjectId,
  ChangeStream,
} = require("mongodb");

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

//custom middleware
const verifyJWT = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    console.log("tokem from headers",authHeader)

    if( !authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).send({message: "Unauthorized"})
    }

    const token = authHeader.split(" ")[1];

    //verify the token
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if(err) {
        res.status(403).send({message: "Forbidden"})
      }


      req.user = decoded;
      next()
    })
}

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
      console.log("idToken", idToken);
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

    app.post("/add-user", async (req, res) => {
      const userData = req.body;

      const find_result = await usersCollection.findOne({
        email: userData.email,
      });

      if (find_result) {
        usersCollection.updateOne(
          { email: userData.email },
          {
            $inc: { loginCount: 1 },
          }
        );
        res.send({ msg: "user already exist" });
      } else {
        const result = await usersCollection.insertOne(userData);
        res.send(result);
      }
    });

    app.get("/get-user-role", async (req, res) => {
      const user = await usersCollection.findOne({
        email: req.query.email,
      });
      res.send({ role: user.role });
    });

    //Admin apis
    //GET admin stats
    app.get("/admin-stats", async ( req, res ) => {
      try {
        const totalPayment = await paymentsCollection
        .aggregate([{ $group: { _id: null, sum: { $sum: "$amount"}}}])
        .toArray();
        const totalGuides = await usersCollection.countDocuments({ role: "tour guide"});
        const totalClients = await usersCollection.countDocuments({ role: "tourist"});
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
        res.status(500).send({message: "Failed to fetch admin stats", err})
      }
    })

    // GET /users?search=keyword
    app.get("/users", verifyJWT, async (req, res) => {
      try {
        const search = req.query.search || "";
        const skipEmail = req.user.email;
        const query = {
          email: { $ne: skipEmail },
          $or: [
            { userName: { $regex: search, $options: "i" } },
            { email: { $regex: search, $options: "i" } },
          ],
        };
        const result = await usersCollection.find(query).toArray();
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: err.massage });
      }
    });

    //Get all applications
    app.get("/applications", async (req, res) => {
      try {
        const result = await applicationsCollection
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
          .toArray();

        res.status(200).send(result);
      } catch (error) {
        res.status(500).json({
          success: false,
          message: error.message,
        });
      }
    });

    app.post("/add-package", async (req, res) => {
      try {
        const packageInfo = req.body;
        const result = await packagesCollection.insertOne(packageInfo);
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: err.message });
      }
    });

    app.get("/all-users", async (req, res) => {
      const { page, filter } = req.query;
      const query = { email: { $ne: req.firebaseUser.email } };

      if (filter && filter !== "all") {
        query.status = filter;
      }
      const totalCount = await usersCollection.countDocuments(query);
      const users = await usersCollection
        .find(query)
        .skip((page - 1) * 5)
        .limit(5)
        .toArray();

      res.send({ users, totalCount });
    });

    // Update user role by email
    app.patch("/users/:email", async (req, res) => {
      try{
        const email = req.params.email;
        const { role } = req.body;

        const result = await usersCollection.updateOne(
          { email },
          { $set: {role} },
          {upsert: false}
        );

        res.send(result)
      } catch (err) {
        res.status(500).send({ message: "Failed to update role", err });
      }
    });

    //Delete application by id
    app.delete("/applications/:id", async( req, res) => {
      try{
        const {id} = req.params;

        const result = await applicationsCollection.deleteOne({ _id: new ObjectId(id)});
        res.send(result)
      } catch(err) {
        res.status(500).send({message: "Failed to delete application", err})
      }
    })


    app.patch(
      "/update-user-status",

      async (req, res) => {
        const { email, status } = req.body;
        const result = await usersCollection.updateOne(
          { email: email },
          {
            $set: { status },
          }
        );

        res.send(result);
      }
    );

    console.log("connected");
  } finally {
  }
}

run().catch(console.dir);

// Root route
app.get("/", async (req, res) => {
  res.send('TourDesh server is running.....')
});

app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});


