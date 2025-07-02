import { PASSWORD_RESET_REQUEST_TEMPLATE, PASSWORD_RESET_SUCCESS_TEMPLATE, VERIFICATION_EMAIL_TEMPLATE, WELCOME_EMAIL_TEMPLATE } from "./emailTemplate.js"
import { transporter } from "./mail.config.js"
import dotenv from 'dotenv';

dotenv.config();

export const sendVerificationEmail = async (email, verificationToken) => {
    const recipient = email;
    try {
        const response = await transporter.sendMail({
            from: process.env.MAIL_ID,
            to: recipient,
            subject: "Verify your email",
            html: VERIFICATION_EMAIL_TEMPLATE.replace("{verificationCode}", verificationToken),
            category: "Email Verification"
        })
        console.log("Email sent successfully");

    } catch (error) {
        console.log(`Error sending verification email: ${error}`);
        throw new Error(`Error sending verification email: ${error}`)
    }
}

export const sendWelcomeEmail = async (email, name) => {
    const recipient = email;
    try {
        const response = await transporter.sendMail({
            from: process.env.MAIL_ID,
            to: recipient,
            subject: "Email Verification Done",
            html: WELCOME_EMAIL_TEMPLATE.replace("{name}", name),
            category: "Email Verified"
        })

        console.log("Welcome email sent succesfully");

    } catch (error) {
        console.log(`Error sending verification email: ${error}`);
        throw new Error(`Error sending verification email: ${error}`);
    }
}

export const sendPasswordResetEmail = async (email, resetURL) => {
    const recipient = email;
    try {
        const response = await transporter.sendMail({
            from: process.env.MAIL_ID,
            to: recipient,
            subject: "Reset your Password",
            html: PASSWORD_RESET_REQUEST_TEMPLATE.replace("{resetURL}", resetURL),
            category: "Password Reset"
        })

        console.log(`Email sent for password reset Successfully`, response);


    } catch (error) {
        console.log(`Error sending password reset email: ${error}`);
        throw new Error(`Error sending password reset email: ${error}`);
    }
}

export const sendResetSuccessEmail = async (email) => {
    const recipient = email;
    try {
        const response = await transporter.sendMail({
            from: process.env.MAIL_ID,
            to: recipient,
            subject: "Password Reset Successful",
            html: PASSWORD_RESET_SUCCESS_TEMPLATE,
            category: "Password Reset Done"
        });

        console.log(`Password reset Successful`);

    } catch (error) {
        console.log(`Error sending password reset success email: ${error}`);
        throw new Error(`Error sending password reset success email: ${error}`);
    }
}