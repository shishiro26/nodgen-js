import bcrypt from "bcrypt";
import User from "../model/User.js";
import otpGenerator from "otp-generator";
import { sendMailer } from "../utils/SendMail.js";
import mongoose from "mongoose";
import OTP from "../model/OTP.js";
import {
  AccessToken,
  RefreshToken,
  verifyRefreshToken,
} from "../utils/GenerateToken.js";
/* Registering the user */
export const register = async (req, res) => {
  try {
    const { firstName, lastName, Username, phoneNumber, email, password } =
      req.body;

    const duplicate = await User.findOne({ email }).lean().exec();
    if (duplicate) {
      return res.status(409).json({
        message: "User already exists. Try signing up with a different email.",
      });
    }

    const salt = await bcrypt.genSalt();
    const hashedPwd = await bcrypt.hash(password, salt);

    const otp = await otpGenerator.generate(6, {
      digits: true,
      specialChars: false,
      upperCaseAlphabets: false,
      lowerCaseAlphabets: false,
    });

    const user = await User.create({
      Username,
      firstName,
      lastName,
      phoneNumber,
      email,
      password: hashedPwd,
      image: `https://api.dicebear.com/5.x/initials/svg?seed=${firstName} ${lastName}`,
      isVerified: false,
    });

    if (!user) {
      throw new Error("Failed to create user");
    }
    await OTP.create({ email, otp });

    sendMailer(email, otp, user.Username, "registration");
    const accessToken = await AccessToken(user._id);
    const refreshToken = await RefreshToken(user._id);

    res.cookie("AccessToken", accessToken, {
      secure: true,
      sameSite: "strict",
      maxAge: 20 * 60 * 1000,
    });
    res.cookie("RefreshToken", refreshToken, {
      secure: true,
      sameSite: "strict",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.status(201).json({
      accessToken,
      refreshToken,
      userId: user._id,
      email: user.email,
    });
  } catch (error) {
    console.error("Error during registration:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

/* logging in the user */
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      throw new Error("User not found");
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new Error("Invalid credentials");
    }

    const accessToken = await AccessToken(user._id);
    const refreshToken = await RefreshToken(user._id);

    res.cookie("AccessToken", accessToken, {
      secure: true,
      sameSite: "strict",
      maxAge: 20 * 60 * 1000,
    });
    res.cookie("RefreshToken", refreshToken, {
      secure: true,
      sameSite: "strict",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.status(200).json({
      accessToken,
      refreshToken,
      userId: user._id,
      email: user.email,
    });
  } catch (err) {
    console.error(err);

    let errorMessage = "Internal server error. Please try again later.";
    if (err.message === "User not found") {
      res.status(404);
      errorMessage = "User not found";
    } else if (err.message === "Invalid credentials") {
      res.status(401);
      errorMessage = "Invalid credentials";
    }
    res.json({ error: errorMessage });
  }
};

export const updatePassword = async (req, res) => {
  try {
    const { id } = req.params;
    const userDetails = await User.findById(id);

    if (!userDetails) {
      throw new Error("User not found");
    }

    if (!userDetails.isVerified) {
      throw new Error("User is not verified");
    }

    const { oldPassword, newPassword, confirmNewPassword } = req.body;

    if (newPassword !== confirmNewPassword) {
      throw new Error("New passwords do not match");
    }

    const isPasswordMatch = await bcrypt.compare(
      oldPassword,
      userDetails.password
    );

    if (!isPasswordMatch) {
      throw new Error("Invalid old password");
    }

    const salt = await bcrypt.genSalt();
    const hashedPwd = await bcrypt.hash(newPassword, salt);

    await User.findByIdAndUpdate(id, { password: hashedPwd });

    res.status(200).json({ message: "Password updated successfully" });
  } catch (error) {
    console.error(error);
    let errorMessage = "Internal server error. Please try again later.";
    if (error.message === "User not found") {
      res.status(404);
      errorMessage = "User not found";
    } else if (error.message === "User is not verified") {
      res.status(401);
      errorMessage = "User is not verified";
    } else if (error.message === "New passwords do not match") {
      res.status(400);
      errorMessage = "New passwords do not match";
    } else if (error.message === "Invalid old password") {
      res.status(401);
      errorMessage = "Invalid old password";
    }
    res.json({ error: errorMessage });
  }
};

/*Updating the image*/
export const updateImage = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new Error("Invalid user ID format");
    }

    const userDetails = await User.findById(id);

    if (!userDetails) {
      throw new Error("User not found");
    }

    if (!userDetails.isVerified) {
      throw new Error("User is not verified");
    }

    if (!req?.file) {
      throw new Error("No image file provided");
    }

    const base64Image = req?.file?.buffer.toString("base64");

    await User.findByIdAndUpdate(id, { image: base64Image });

    res.status(200).json({ message: "Image updated successfully" });
  } catch (err) {
    console.error(err);
    let errorMessage = "Internal server error. Please try again later.";
    if (err.message === "Invalid user ID format") {
      res.status(400);
      errorMessage = "Invalid user ID format";
    } else if (err.message === "User not found") {
      res.status(404);
      errorMessage = "User not found";
    } else if (err.message === "User is not verified") {
      res.status(401);
      errorMessage = "User is not verified";
    } else if (err.message === "No image file provided") {
      res.status(400);
      errorMessage = "No image file provided";
    }
    res.json({ error: errorMessage });
  }
};

/* Logout the user */
export const logout = (req, res) => {
  res.cookie("AccessToken", "", {
    httpOnly: true,
    expires: new Date(0),
  });
  res.cookie("RefreshToken", "", {
    httpOnly: true,
    expires: new Date(0),
  });
  res.status(200).json({ message: "user logged out successfully" });
};

/* Get the user Info */
export const userInfo = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new Error("Invalid user ID format");
    }

    if (req.payload.aud !== id) {
      throw new Error("Invalid access token");
    }

    const user = await User.findById(id);

    if (!user) {
      throw new Error("User not found");
    }

    if (!user.isVerified) {
      throw new Error("User is not verified");
    }

    res.status(200).json({ data: user });
  } catch (error) {
    console.error(error);
    let errorMessage = "Internal server error. Please try again later.";
    if (error.message === "Invalid user ID format") {
      res.status(400);
      errorMessage = "Invalid user ID format";
    } else if (error.message === "Invalid access token") {
      res.status(401);
      errorMessage = "Invalid access token";
    } else if (error.message === "User not found") {
      res.status(404);
      errorMessage = "User not found";
    } else if (error.message === "User is not verified") {
      res.status(401);
      errorMessage = "User is not verified";
    }
    res.json({ error: errorMessage });
  }
};

/* Delete the user with the delayed deletion  */
export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.body;
    const userDetails = await User.findOne({ _id: id })
      .select("-password")
      .exec();

    if (!userDetails) {
      return res.status(409).json("No such user found");
    }

    if (userDetails.isVerified) {
      const { otp } = req.body;
      const foundOTP = await OTP.findOne({ email, otp }).exec();

      if (foundOTP) {
        await User.findOneAndUpdate({ _id: id }, { markedForDeletion: true });

        sendMailer(email, otp, userDetails.Username, "accountDeleted");
        if (userDetails.markedForDeletion === true) {
          setTimeout(async () => {
            try {
              await User.deleteOne({ _id: id });
              const likedEmail = await Email.deleteOne({
                email: userDetails.email,
              });
              if (!likedEmail) {
                console.log(`${userDetails.email} do not exist!! `);
              }
              res.cookie("AccessToken", "", {
                httpOnly: true,
                expires: new Date(0),
              });
              res.cookie("RefreshToken", "", {
                httpOnly: true,
                expires: new Date(0),
              });
              res.status(200).json({ message: "user logged out successfully" });
              console.log(
                "User and email is deleted and loggedout successfully"
              );
            } catch (err) {
              console.log(`Error in the setTimeout${err.message}`);
            }
          }, 1000 * 60 * 60);
        }
        return res.status(200).json("User Deleted Successfully");
      } else {
        return res.status(400).json("OTP doesn't match");
      }
    } else {
      return res.status(401).json("Verify Your Email");
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const refreshroute = async (req, res) => {
  try {
    const refreshToken = req.cookies.RefreshToken;
    if (!refreshToken) {
      return res.status(401).json({ error: "Refresh token missing" });
    }

    const userId = await verifyRefreshToken(refreshToken);
    if (!userId) {
      return res.status(401).json({ error: "Invalid refresh token" });
    }

    const accessToken = await AccessToken(userId);
    const refToken = await RefreshToken(userId);

    res.cookie("AccessToken", accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: 20 * 60 * 1000,
    });
    res.cookie("RefreshToken", refToken, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.status(200).json({ AccessToken: accessToken, refreshToken: refToken });
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({ error: "Invalid refresh token" });
    } else if (error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Refresh token expired" });
    } else {
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }
};
