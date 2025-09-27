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


async function run() {
  try {
     const db = client.db("LifeDropDb");
     const donationRequestCollection = db.collection("donationRequests");
     const blogsCollection = db.collection("blogs");
    const userCollection = db.collection("users");

    // const verifyAdmin = async (req, res, next) => {
    //   const user = await userCollection.findOne({
    //     email: req.firebaseUser.email,
    //   });

    //   if (user.role === "admin") {
    //     next();
    //   } else {
    //     res.status(403).send({ msg: "unauthorized" });
    //   }
    // };

   

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

    app.get("/get-user-role",  async (req, res) => {
      const user = await userCollection.findOne({
        email: req.firebaseUser.email,
      });
      res.send({ role: user.role });
    });

    app.get(
      "/all-users",     
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
    app.patch(
      "/update-user-status",
      
     
      async (req, res) => {
        const { email, status } = req.body;
        const result = await userCollection.updateOne(
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


