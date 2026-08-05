import mongoose, { Document, Model } from "mongoose";

interface IUser {
  email: string;
  password_hash: string;
  created_at: Date;
}

export interface IUserDocument extends IUser, Document {
  _id: mongoose.Types.ObjectId;
}

const UserSchema = new mongoose.Schema<IUserDocument>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password_hash: {
      type: String,
      required: true,
    },
    created_at: {
      type: Date,
      default: () => new Date(),
    },
  },
  {
    collection: "users",
  }
);

const User: Model<IUserDocument> =
  mongoose.models.User ?? mongoose.model<IUserDocument>("User", UserSchema);

export default User;
