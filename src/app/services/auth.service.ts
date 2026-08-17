import UserModel from '../models/user.model';
import CompanyModel from '../models/company.model';
import HTTP400Error from '@surefy/exceptions/HTTP400Error';
import HTTP401Error from '@surefy/exceptions/HTTP401Error';
import HTTP404Error from '@surefy/exceptions/HTTP401Error';
import * as bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import sendEmail from '../../utils';
import passwordResetModel from '../models/passwordReset.model';
import crypto from 'crypto';
import storesSessionModel from '../models/storesSession.model';
import chatSessionModel from '../models/chatSession.model';
import userModel from '../models/user.model';
import phoneNumberModel from '../models/phoneNumber.model';
import productGroupModel from '../models/productGroup.model';
import productVariantModel from '../models/productVariant.model';
import axios from 'axios'

interface LoginCredentials {
  identifier: string; // email or phone
  password: string;
}

interface JWTPayload {
  userId: string;
  email?: string;
  phone?: string;
  role: string;
  companyId?: string;
}

class AuthService {
  private JWT_SECRET: string;
  private JWT_EXPIRES_IN: string;

  constructor() {
    this.JWT_SECRET = process.env.JWT_SECRET || '1234';
    this.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
  }

  /**
   * Login with email or phone number
   */
  async login(credentials: LoginCredentials, ipAddress: string) {
    const { identifier, password } = credentials;

    if (!identifier || !password) {
      throw new HTTP400Error({ message: 'Identifier and password are required' });
    }

    // Find user by email or phone
    const user = await UserModel.findByEmailOrPhone(identifier);

    if (!user) {
      throw new HTTP401Error({ message: 'Invalid credentials' });
    }

    // Check if user is active
    if (user.status !== 'active') {
      throw new HTTP401Error({ message: 'Account is not active' });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new HTTP401Error({ message: 'Invalid credentials' });
    }

    // Get company details if user has company_id
    let company = null;
    if (user.company_id) {
      company = await CompanyModel.findById(user.company_id);
    }

    // Update last login
    await UserModel.updateLastLogin(user.id, ipAddress);

    // Generate JWT token
    const token = this.generateToken({
      userId: user.id,
      email: user.email,
      phone: user.phone,
      role: user.role,
      companyId: user.company_id,
    });

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword,
      company,
      token,
      expiresIn: this.JWT_EXPIRES_IN,
    };
  }

  // {
  // "id": "4e9c6c07-d5c5-4257-a4a6-3f301bdbc2ac",
  // "name": "parth",
  // "role": "farmer",
  // "email": "parthvichare8@gmail.com",
  // "photo": "https://storage.googleapis.com/krishione-dashboard.appspot.com/2276414856464447_1784090816741.jpg",
  // "location": {
  //   "latitude": 19.0234466,
  //   "longitude": 72.8644724
  // },
  // "phone_number": "919372597458",

  //   POST:https://l07yapr0ub.execute-api.ap-south-1.amazonaws.com/prod/farmer-function/register-user

  // {
  //   "_id": {
  //     "$oid": "639d60ae2c2da10008d775ec"
  //   },
  //   "farming_mode": "Agriculture",
  //   "created_by": "micro-entrepreneur",
  //   "userType": "farmer",
  //   "full_address": "XP29+QG Gangadevi Pally, Telangana, India",
  //   "pincode": "506330",
  //   "village": "machapur",
  //   "sub_distric": "Gangadevi Pally",
  //   "district": "Warangal",
  //   "state": "Telangana",
  //   "mobile_number": "9908863390",
  //   "photo": "https://firebasestorage.googleapis.com/v0/b/krishivan-app.appspot.com/o/users%2FzUBZiGjUldguExYs6QQAIwnJwgv1.jpg?alt=media&token=9bd1fa82-1ec0-47e3-8b2e-8b842aabc283",
  //   "role": "farmer",
  //   "dob": "1998-07-14 0:00:00",
  //   "gender": "Male",
  //   "last_name": "anil",
  //   "first_name": "singireddy",
  //   "user_id": "zUBZiGjUldguExYs6QQAIwnJwgv1",
  //   "coordinates": {
  //     "type": "type",
  //     "coordinates": [
  //       79.7187787,
  //       17.9519822
  //     ]
  //   },
  //   "created_at": {
  //     "$numberLong": "1671258286932"
  //   },
  //   "isDeleted": false,
  //   "id": "FR48314814",
  //   "createdById": "QVgmybHDDghAZZtWBj6mL7eyRbu2",
  //   "sequence_value": 0,
  //   "isMigrated": true,

  //   "languages": [
  //     "te",
  //     "hi",
  //     "en"
  //   ],
  //   "primary_language": "te"
  // }


  /**
   * REGISTER krishivan user
   */
  async registerkrishivanUser(data: any) {
    console.log("Krishivan Data", data)
    try {
      const response = await axios.post(
        'https://l07yapr0ub.execute-api.ap-south-1.amazonaws.com/prod/farmer-function/register-user',
        data,
        {
          headers: {
            'X-Internal-Api-Key': 'krishiwhatsappskjf4543k',
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('Response krishivan', response)

      return response.data;
    } catch (error: any) {
      if (error.response?.status === 409) {
        console.log("⚠️ Mobile number already registered");

        return {
          success: false,
          alreadyRegistered: true,
          message: error.response.data.message
        };
      }

      throw error; // only throw unexpected errors
    }
  }


  /**
   * REGISTER user
   */
  // async registerUser(
  //   companyDetails: any,
  //   data: any,
  //   parent_user_id?: any
  // ) {
  //   console.log("User register",data,companyDetails)
  //   const company = data.company_details || {};

  //   const role = data.role || "FPO";

  //   const name =
  //     data.name ||
  //     company.trade_name ||
  //     company.legal_name;

  //   const phone_number = data.phone_number;

  //   const state =
  //     company.state || null;

  //   const state_info =
  //     company.state_info || null;

  //   const location =
  //     data.location || {};

  //   const native_language =
  //     data.native_language || null;

  //   const photo =
  //     data.photo || null;

  //   const email =
  //     data.email || null;

  //   const rolePrefix = role
  //     .toUpperCase()
  //     .slice(0, 3);

  //   const randomNumber =
  //     Math.floor(
  //       100000 + Math.random() * 900000
  //     );

  //   const roleCode =
  //     `${rolePrefix}${randomNumber}`;

  //   const krishivanResponse =
  //     await this.registerkrishivanUser({
  //       farming_mode: "Agriculture",
  //       userType: role,
  //       role,
  //       coordinates: {
  //         type: "Point",
  //         coordinates: [
  //           location?.longitude || 0,
  //           location?.latitude || 0
  //         ]
  //       },
  //       id: roleCode,
  //       createdById:
  //         "QVgmybHDDghAZZtWBj6mL7eyRbu2",
  //       primary_language:
  //         native_language,
  //       gender: "Male",
  //       photo,
  //       first_name: name,
  //       last_name: name,
  //       mobile_number: phone_number,
  //       user_id:
  //         parent_user_id || null,
  //       password: "123456"
  //     });

  //   console.log(
  //     "Krishivan Response",
  //     krishivanResponse
  //   );

  //   const krishivanUserId =
  //     krishivanResponse?.user_id ||
  //     krishivanResponse?.id ||
  //     null;

  //   let user =
  //     await userModel.findByPhone(
  //       phone_number
  //     );

  //   const userPayload = {
  //     company_id:
  //       companyDetails.company_id,

  //     user_id: krishivanUserId,

  //     name,
  //     email,

  //     phone: phone_number,

  //     password: "123456",

  //     role,
  //     role_id: roleCode,

  //     native_language,

  //     image_url: photo,

  //     location,

  //     state,
  //     state_info,

  //     company_details: company
  //   };

  //   if (user) {
  //     return await userModel.update(
  //       user.id,
  //       {
  //         ...userPayload
  //       }
  //     );
  //   }

  //   return await userModel.create(
  //     userPayload
  //   );
  // }

  async registerUser(
    companyDetails: any,
    data: any,
    parent_user_id?: any
  ) {
    // const isFPO = !!data.company_details;

    const role = data.role || 'USER';

    const rolePrefix = role
      .toUpperCase()
      .slice(0, 3);

    const randomNumber = Math.floor(
      100000 + Math.random() * 900000
    );

    const roleCode = `${rolePrefix}${randomNumber}`;

    const company = data.details || {};

    const payload = {
      farming_mode: "Agriculture",

      userType: role,

      created_by:"fpo",
      createdById:data.fpo_id,

      role,

      kyc_data: company
        ? {
          gst_no: data.gstin || null,
          pan_no: company.pan || null,
          company_name:
            company.trade_name ||
            company.legal_name,

          address: {
            full_address:
              company?.pradr?.addr || null,
            state:
              company?.pradr?.state_in_address ||
              company?.state_info?.name,
            district:
              company?.pradr?.district || null,
            sub_distric: "",
            village: "",
            pincode:
              company?.pradr?.pincode ||
              company?.pradr?.pinc ||
              null,
          },
        }
        : null,

      coordinates: {
        type: "Point",
        coordinates: [
          data?.location?.longitude ||
          company?.pradr?.longitude ||
          null,

          data?.location?.latitude ||
          company?.pradr?.latitude ||
          null,
        ],
      },

      id: roleCode,

      primary_language:
        data.native_language || null,

      gender: "Male",

      photo: data.photo || null,

      first_name:
        data.name ||
        company.trade_name ||
        company.legal_name,

      last_name:
        data.name ||
        company.trade_name ||
        company.legal_name,

      mobile_number:
        data.phone_number,

      user_id:
        parent_user_id || null,

      password: "123456",
    };

    const krishivanResponse =
      await this.registerkrishivanUser(payload);

    const krishivanUserId =
      krishivanResponse?.user_id ||
      krishivanResponse?.data?.user_id ||
      null;

    let user = await userModel.findByPhone(
      data.phone_number
    );

    const userPayload = {
      company_id: companyDetails.company_id,

      name:
        data.name ||
        company.trade_name ||
        company.legal_name,

      email: data.email || null,

      phone: data.phone_number,

      password: "123456",

      role: "user",

      role_id: roleCode,

      native_language:
        data.native_language || null,

      image_url: data.photo || null,

      location: data.location || {},

      state: company.state || null,

      state_info:
        company.state_info || null,

      parent_user_id: data.parent_user_id,

      // company_details: company,

      user_id: krishivanUserId
    };

    if (user) {
      return await userModel.update(
        user.id,
        userPayload
      );
    }

    return await userModel.create(
      userPayload
    );
  }

  async sendOtp(email: string, otp: string) {
    // Generate OTP
    const existUser = await UserModel.findByEmail(email);
    if (!existUser) {
      throw new HTTP400Error({ message: 'User with this email does not exist' });
    }

    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

    // Save OTP to database with expiration (e.g., 10 minutes)
    // await passwordResetModel.create(existUser.id, { otp, expiresAt: new Date(Date.now() + 10 * 60 * 1000), email });

    await passwordResetModel.create({
      user_id: existUser.id,
      otp_hash: otpHash,
      expires_at: new Date(Date.now() + 10 * 60 * 1000),
      email: email,
    });

    // Send OTP via email (implement your email service)
    await sendEmail(email, 'Your Password Reset OTP', `Your OTP is: ${otp}`);
    return { message: 'OTP sent to email' };
  }

  async verifyOtp(otp: string, email: string,) {
    console.log('Verifying OTP for email:', email);
    const record = await passwordResetModel.findLatestByEmail(email);
    console.log('OTP Record:', record);

    if (!record) {
      throw new HTTP400Error({ message: 'Invalid request' });
    }

    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

    if (otpHash !== record.otp_hash) {
      throw new HTTP400Error({ message: 'Invalid OTP' });
    }

    if (record.expires_at < new Date()) {
      throw new HTTP400Error({ message: 'OTP expired' });
    }

    // ✅ Mark verified
    await passwordResetModel.update(record.id, { verified: true });

    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET is not defined');
    }

    // ✅ Generate reset token
    const resetToken = jwt.sign({ userId: record.user_id }, process.env.JWT_SECRET, { expiresIn: '10m' });

    return { resetToken };
  }

  /**
   * Register new user (company role)
   */
  async register(data: {
    name: string;
    email?: string;
    phone?: string;
    company_id?: string;
    password: string;
    role: string;
    user_role?: any
  }) {
    const { name, email, phone, company_id, password, user_role } = data;

    console.log('Registering user with data:', data);

    // Validate
    if (!email && !phone) {
      throw new HTTP400Error({ message: 'Either email or phone is required' });
    }

    // Check existing
    if (email) {
      const existingUser = await UserModel.findByEmail(email);
      if (existingUser) {
        throw new HTTP400Error({ message: 'Email already registered' });
      }
    }

    if (phone) {
      const existingUser = await UserModel.findByPhone(phone);
      if (existingUser) {
        throw new HTTP400Error({ message: 'Phone number already registered' });
      }
    }


    // Hash password
    const hashedPassword = await this.hashPassword(password);

    // Create user
    const user = await UserModel.create({
      name,
      email,
      phone,
      company_id,
      password: hashedPassword,
      role: data.role,
      user_role,
      status: 'active'
    });

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    return userWithoutPassword;
  }

  /**
   * Create admin or superadmin user (restricted)
   */
  async createAdminUser(
    data: {
      name: string;
      email?: string;
      phone?: string;
      password: string;
      role: 'admin' | 'superadmin';
      company_id?: string;
    },
    createdBy: string,
    creatorRole: string,
  ) {
    // Only superadmin can create other admins
    if (creatorRole !== 'superadmin') {
      throw new HTTP401Error({ message: 'Unauthorized to create admin users' });
    }

    const { name, email, phone, password, role, company_id } = data;

    // Validate at least email or phone is provided
    if (!email && !phone) {
      throw new HTTP400Error({ message: 'Either email or phone is required' });
    }

    // Check if user already exists
    if (email) {
      const existingUser = await UserModel.findByEmail(email);
      if (existingUser) {
        throw new HTTP400Error({ message: 'Email already registered' });
      }
    }

    if (phone) {
      const existingUser = await UserModel.findByPhone(phone);
      if (existingUser) {
        throw new HTTP400Error({ message: 'Phone number already registered' });
      }
    }

    // Hash password
    const hashedPassword = await this.hashPassword(password);

    // Create user
    const user = await UserModel.create({
      name,
      email,
      phone,
      password: hashedPassword,
      role,
      company_id,
      status: 'active',
    });

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    return userWithoutPassword;
  }

  /**
   * Verify JWT token
   */
  verifyToken(token: string): JWTPayload {
    try {
      return jwt.verify(token, this.JWT_SECRET) as JWTPayload;
    } catch (error) {
      throw new HTTP401Error({ message: 'Invalid or expired token' });
    }
  }

  /**
   * Generate JWT token
   */
  private generateToken(payload: JWTPayload): string {
    return jwt.sign(payload, this.JWT_SECRET, {
      expiresIn: this.JWT_EXPIRES_IN,
    } as jwt.SignOptions);
  }

  /**
   * Hash password
   */
  async hashPassword(password: string): Promise<string> {
    const saltRounds = 10;
    return bcrypt.hash(password, saltRounds);
  }

  /**
   * Change password
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await UserModel.findById(userId);

    if (!user) {
      throw new HTTP400Error({ message: 'User not found' });
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);

    if (!isPasswordValid) {
      throw new HTTP401Error({ message: 'Current password is incorrect' });
    }

    // Hash new password
    const hashedPassword = await this.hashPassword(newPassword);

    // Update password
    await UserModel.changePassword(userId, hashedPassword);

    return { message: 'Password changed successfully' };
  }

  /**
   * Get user profile
   */
  async getProfile(userId: string) {
    const user = await UserModel.findById(userId);

    if (!user) {
      throw new HTTP400Error({ message: 'User not found' });
    }

    // Get company details if user has company_id
    let company = null;
    if (user.company_id) {
      company = await CompanyModel.findById(user.company_id);
    }

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword,
      company,
    };
  }

  async resetPassword(token: string, newPassword: string) {
    let decoded;
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET is not defined');
    }

    try {
      decoded = jwt.verify(token, this.JWT_SECRET);
    } catch {
      throw new HTTP400Error({ message: 'Invalid or expired token' });
    }

    const { userId }: any = decoded;

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await UserModel.update(userId, { password: hashedPassword });

    // cleanup
    await passwordResetModel.deleteByUserId(userId);

    return { message: 'Password reset successful' };
  }

  async storedChatSession(phone_number: any, data: any) {
    try {
      console.log('details', phone_number, data)
      const existingSession = await chatSessionModel.findByPhoneNumber(phone_number);

      if (!existingSession) {
        return {
          success: false,
          message: "No active session found"
        };
      }

      // Deactivate session immediately on API call
      await chatSessionModel.update(existingSession.id, {
        active: false
      });

      console.log(`Session ${existingSession.id} deactivated`);

      // const existingStoredSession =
      //   await storesSessionModel.findByPhoneNumber(phone_number);

      // if (existingStoredSession) {
      //   return {
      //     success: false,
      //     data: existingStoredSession.data
      //   };
      // }

      const companyDetails =
        await phoneNumberModel.findByPhoneNumberId(
          existingSession.phoneNumberId
        );

      if (!companyDetails) {
        return {
          success: false,
          message: "Company details not found"
        };
      }

      const storedSession = await storesSessionModel.create({
        user_id: companyDetails.user_id,
        company_id: companyDetails.company_id,
        phone_number,
        data
      });

      const userRegistration = await this.registerUser(
        companyDetails,
        data
      );

      return {
        success: true,
        data: storedSession,
        created: userRegistration.created,
        user: userRegistration.user
      };
    } catch (error) {
      console.error("storedChatSession Error:", error);
      throw error;
    }
  }

  async checkExistUser(phone_number: any) {
    console.log("Phone number", phone_number)
    const existUser = await userModel.findByPhone(phone_number)
    console.log("Existisng user", existUser)
    return existUser
  }

  async getProductVariants(category: string, catalog_id: string) {
    console.log("Category", category, catalog_id)
    const existingCategory = await productGroupModel.findGroupByCategory(category, catalog_id)
    const existingProductVariant = await productVariantModel.findByCategory(category, catalog_id)
    if (!existingCategory || !existingProductVariant || existingProductVariant.length === 0) {
      return { success: false, message: "Product Variant with those category not exists" }
    }
    const retailerIds = existingProductVariant.map(
      (product) => product.retailer_id
    );

    return {
      success: true,
      data: retailerIds,
    };
  }

  async registerData(session_data: any) {
    const { name, email, photo, role, phone, roleId, parent_user_id, user_id, native_language } = session_data
    const registerUser = await userModel.create({
      company_id: 'e964154b-7ed9-423d-bee3-c6e190dc0ab2',
      name,
      email,
      parent_user_id,
      password: '123456',
      roleId,
      photo,
      phone,
      user_id,
      role: 'user',
      user_role: role,
      native_language
    })

    return {
      success: true,
      data: registerUser
    }
  }
}

export default new AuthService();
