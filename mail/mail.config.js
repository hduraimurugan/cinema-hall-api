import dotenv from "dotenv";
import nodemailer from "nodemailer"

dotenv.config();

export const transporter = nodemailer.createTransport({
    service: 'gmail',
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
     user:process.env.MAIL_ID,
     pass:process.env.MAIL_PASSWORD,
    },
   });
