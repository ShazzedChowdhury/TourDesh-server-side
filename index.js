const dotenv = require("dotenv");
dotenv.config();
const express = require("express");
const cors = require("cors");
const {
  MongoClient,
  ServerApiVersion,
  ObjectId,
  ChangeStream,
} = require("mongodb");

var admin = require("firebase-admin");

var serviceAccount = JSON.parse(
  Buffer.from(process.env.FIREBASE_SERVICE_KEY, "base64").toString("utf8")
);


admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// const serviceAccount = require("./admin-key.json");

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  console.log("🚀 ~ verifyFirebaseToken ~ authHeader:", authHeader);

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized: No token provided" });
  }

  const idToken = authHeader.split(" ")[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.firebaseUser = decodedToken; // You can access user info like uid, email, etc.
    next();
  } catch (error) {
    return res
      .status(401)
      .json({ message: "Unauthorized: Invalid token from catch" });
  }
};

async function run() {
  try {
    await client.connect();
     const db = client.db("LifeDropDb");
     const donationRequestCollection = db.collection("donationRequests");
    const userCollection = db.collection("users");

    const verifyAdmin = async (req, res, next) => {
      const user = await userCollection.findOne({
        email: req.firebaseUser.email,
      });

      if (user.role === "admin") {
        next();
      } else {
        res.status(403).send({ msg: "unauthorized" });
      }
    };

   

    app.post("/add-user", async (req, res) => {
      const userData = req.body;

      const find_result = await userCollection.findOne({
        email: userData.email,
      });

      if (find_result) {
        userCollection.updateOne(
          { email: userData.email },
          {
            $inc: { loginCount: 1 },
          }
        );
        res.send({ msg: "user already exist" });
      } else {
        const result = await userCollection.insertOne(userData);
        res.send(result);
      }
    });

    app.get("/get-user-role", verifyFirebaseToken, async (req, res) => {
      const user = await userCollection.findOne({
        email: req.firebaseUser.email,
      });
      res.send({ role: user.role });
    });

    app.get(
      "/all-users",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const {page, filter} = req.query;
        const query = { email: { $ne: req.firebaseUser.email } };
        
        if(filter && filter !== "all") {
          query.status = filter         
        }
        const totalCount = await userCollection.countDocuments(query);
        const users = await userCollection
          .find(query)
          .skip((page-1) * 5)
          .limit(5)
          .toArray();

        res.send({users, totalCount});
      }
    );

    app.patch(
      "/update-role",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const { email, role } = req.body;
        const result = await userCollection.updateOne(
          { email: email },
          {
            $set: { role },
          }
        );

        res.send(result);
      }
    );

    //admin dashboard stats
    app.get("/admin/stats", verifyFirebaseToken, async (req, res) => {
      try {
        const totalDonors = await userCollection.countDocuments({ role: "donor"});
        const totalRequests = await donationRequestCollection.countDocuments() 
          

        res.send({totalDonors, totalRequests});
      } catch (error) {
        console.error("Error fetching donation requests:", error);
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    //donation related api
    app.get("/recent-donation-requests", verifyFirebaseToken, async (req, res) => {
      try {
        const email = req.firebaseUser.email;
        console.log(email)
        const requests = await donationRequestCollection
          .find({ requesterEmail: email })
          .sort({ createdAt: -1 }) // Most recent first
          .limit(3)
          .toArray();

        res.send(requests);
      } catch (error) {
        console.error("Error fetching donation requests:", error);
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    app.get("/all-donation-requests", verifyFirebaseToken, async (req, res) => {
      try {
        const { page, filter } = req.query;
        const query = {};

        if (filter && filter !== "all") {
          query.donationStatus = filter;
        }
        const totalCount = await donationRequestCollection.countDocuments(
          query
        );
        const requests = await donationRequestCollection
          .find(query)
          .skip((page - 1) * 5)
          .limit(5)
          .toArray();

        res.send({ requests, totalCount });
      } catch (error) {
        console.error("Error fetching donation requests:", error);
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

     app.get(
       "/my-donation-requests",
       verifyFirebaseToken,
       async (req, res) => {
         try {
           const email = req.firebaseUser.email;
           const {page, filter} = req.query;
           const query = {
             requesterEmail: email
           };
           
           if(filter && filter !== "all") {
            query.donationStatus = filter
           }
           const totalCount = await donationRequestCollection.countDocuments(query);
           const requests = await donationRequestCollection
             .find(query)
             .skip((page-1) * 3)
             .limit(3)
             .toArray();

           res.send({requests, totalCount});
         } catch (error) {
           console.error("Error fetching donation requests:", error);
           res
             .status(500)
             .send({ message: "Server error", error: error.message });
         }
       }
     );

    app.get("/donation-request/:id", verifyFirebaseToken, async (req, res) => {
      try {
        const { id } = req.params;

        const request = await donationRequestCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!request) {
          return res
            .status(404)
            .send({ message: "Donation request not found" });
        }

        res.send(request);
      } catch (error) {
        console.error("Error fetching donation request by ID:", error);
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });


    app.post("/donation-request", verifyFirebaseToken, async (req, res) => {
      try {
        const donationData = req.body;

        donationData.createdAt = new Date().toISOString();

        const result = await donationRequestCollection.insertOne(donationData);
        res.status(201).send(result);
      } catch (error) {
        console.error("Error creating donation request:", error);
        res.status(500).send({ message: "Server error", error: error.message });
      }
    });

    app.patch(
      "/update-donation-request/:id",
      verifyFirebaseToken,
      async (req, res) => {
        try {
          const { id } = req.params;

          const updateData = req.body;

          const result = await donationRequestCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: updateData }
          );

          if (result.matchedCount === 0) {
            return res
              .status(404)
              .send({ message: "Donation request not found" });
          }

          res.send(result);
        } catch (error) {
          console.error("Error updating donation request:", error);
          res
            .status(500)
            .send({ message: "Server error", error: error.message });
        }
      }
    );

    console.log("connected");
  } finally {
  }
}

run().catch(console.dir);

// Root route
app.get("/", async (req, res) => {
  res.send('server is running.....')
});

app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});


