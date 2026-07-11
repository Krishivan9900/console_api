import { Request, Response } from 'express';
import { successResponse, tryCatchAsync } from '@surefy/utils/Controller';
import { HttpStatusCode } from '@surefy/utils/HttpStatusCode';
import AuthService from '@surefy/console/services/auth.service';
import HTTP400Error from '@surefy/exceptions/HTTP400Error';
import companyController from './company.controller';
import companyService from '../../services/company.service';
import sendEmail from '../../../utils';
import { uploadImage } from '@surefy/config/firebase.config';
import catalogService from '../../services/catalog.service';

export interface JWTRequest extends Request {
  userId?: string;
  userRole?: string;
  companyId?: string;
}

class AuthController {
  /**
   * POST /v1/auth/login
   * Login with email or phone
   */
  login = tryCatchAsync(async (req: Request, res: Response) => {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      throw new HTTP400Error({ message: 'Identifier (email or phone) and password are required' });
    }

    const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';

    const result = await AuthService.login({ identifier, password }, ipAddress);

    return successResponse(req, res, 'Login successful', result);
  });


  /**
   * POST /v1/auth/verify-otp
   * VERIFY OTP for password Reset
   */
  sendOtp = tryCatchAsync(async(req:Request,res:Response)=>{
    const {email} = req.body;
    if(!email){
      throw new HTTP400Error({message: 'Email is required'})  
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    const verifyOtp = await AuthService.sendOtp(email,otp)
    return successResponse(req,res,`OTP sent successfully to ${email}`, verifyOtp)
  })

  /**
   * POST /v1/verify-otp
   * Verify OTP for password reset
   */
  verifyOtp = tryCatchAsync(async(req:Request,res:Response)=>{
    const {email,otp} = req.body;

    if(!otp && !email){
      throw new HTTP400Error({message: 'OTP and email are required'})  
    }

    const verifyOtp = await AuthService.verifyOtp(otp,email)
    return successResponse(req,res,'OTP verified successfully', verifyOtp)
  })
  

  /**
   * POST /v1/companies
   * Onboard new company
   */
  onboard = tryCatchAsync(async (req: Request, res: Response) => {
    const { name, email, phone, user } = req.body;
    console.log('Onboarding company with data:', { name, email, phone, user });

    if (!name || !email) {
      throw new HTTP400Error({ message: 'Name and email are required' });
    }

    if (!user || !user.name || !user.password || (!user.email && !user.phone)) {
      throw new HTTP400Error({
        message: 'User details are required: name, password, and either email or phone',
      });
    }

    const result = await companyService.onboardCompany({
      name,
      email,
      phone,
      user,
    });

    // if(result){
    //   await sendEmail(
    //     email,
    //    'Welcome to Our Platform',
    //    `Hi ${name},\n\nWelcome to our platform! Your account has been created successfully. You can now log in using your Email: ${email} or Phone: ${phone}.\n\nBest regards,\nThe Soft 7 Team`,
    //   )
    // }

    return successResponse(req, res, 'Company and user created successfully', result, HttpStatusCode.CREATED);
  });

  /**
   * POST /v1/auth/register-company
   * Register new company along with admin user
   */

  /**
   * POST /v1/auth/register
   * Register new company user
   */
  register = tryCatchAsync(async (req: Request, res: Response) => {
    const { name, email, phone, password } = req.body; 
    // const permissions = ["dashboard", "inbox", "contact", "campaigns", "integrations", "manage", "gallery", "faq bot", "chatbot", "ai assistant", "flows", "developers", "reminder", "settings","templates","whatsapp-flows","chatbot","knowledge-base"]

    if (!name || !password) {
      throw new HTTP400Error({ message: 'Name and password are required' });
    }

    if (!email && !phone) {
      throw new HTTP400Error({ message: 'Either email or phone is required' });
    }

    const user = await AuthService.register({
      name,
      email,
      phone,
      password,
      role: 'user'
    });

    // if(user){
    //   await sendEmail(
    //     email,
    //    'Welcome to Our Platform',
    //    `Hi ${name},\n\nWelcome to our platform! Your account has been created successfully. You can now log in using your Email: ${email} or Phone: ${phone}.\n\nBest regards,\nThe Soft 7 Team`,
    //   )
    // }

    return successResponse(req, res, 'User registered successfully', user, HttpStatusCode.CREATED);
  });

  /**
   * POST /v1/auth/create-admin
   * Create admin/superadmin user (superadmin only)
   */
  createAdmin = tryCatchAsync(async (req: JWTRequest, res: Response) => {
    const { name, email, phone, password, role, company_id } = req.body;

    if (!name || !password || !role) {
      throw new HTTP400Error({ message: 'Name, password, and role are required' });
    }

    if (!email && !phone) {
      throw new HTTP400Error({ message: 'Either email or phone is required' });
    }

    if (role !== 'admin' && role !== 'superadmin') {
      throw new HTTP400Error({ message: 'Role must be either admin or superadmin' });
    }

    const user = await AuthService.createAdminUser(
      {
        name,
        email,
        phone,
        password,
        role,
        company_id,
      },
      req.userId!,
      req.userRole!,
    );

    return successResponse(req, res, `${role} user created successfully`, user, HttpStatusCode.CREATED);
  });

  /**
   * GET /v1/auth/profile
   * Get current user profile
   */
  getProfile = tryCatchAsync(async (req: JWTRequest, res: Response) => {
    const result = await AuthService.getProfile(req.userId!);
    return successResponse(req, res, 'Profile retrieved successfully', result);
  });

  /**
   * POST /v1/auth/change-password
   * Change user password
   */
  changePassword = tryCatchAsync(async (req: JWTRequest, res: Response) => {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      throw new HTTP400Error({ message: 'Current password and new password are required' });
    }

    if (new_password.length < 6) {
      throw new HTTP400Error({ message: 'New password must be at least 6 characters long' });
    }

    const result = await AuthService.changePassword(req.userId!, current_password, new_password);

    return successResponse(req, res, result.message);
  });

  async forgotPassword(req:Request,res:Response){
    const{token, newPassword} = req.body;
    const result = await AuthService.resetPassword(token,newPassword)
    return successResponse(req, res, 'Password reset successfully', result);
  }

  async verify(req: Request, res: Response) {
    return res.status(200).json({
      success: false,
      message: "Service is healthy",
      data: {
        status: "UP",
        database: "Connected",
        timestamp: new Date().toISOString()
      }
    });
  }

  async storedChatSession(req:Request,res:Response){
    const{session_data} = req.body
    if(!session_data){
      return res.status(200).json({success:false, message:"Sessions required"})
    }
    console.log("Session Data",session_data)
    const result = await AuthService.storedChatSession(session_data.phone_number,session_data)
    return res.status(200).json(result)
  }

  async checkExistUser(req:Request,res:Response){
    const{session_data} = req.body
    console.log("Session data",session_data)
    const data = await AuthService.checkExistUser(session_data.phone_number)
    if(!data){
      return res.status(200).json({success:false,message:"User not found", data})
    }

    return res.status(200).json({success:true,message:"User retrived successfully", data})
  }

  async uploadMedia(req:Request,res:Response){
    const file = req.file
    console.log("File",file)

    if(file){
      const media_url = await uploadImage(file)
      console.log("Media", media_url)
      return res.status(200).json({success:true,message:"Media upload successfully", media_url:media_url })
    }
  }

  async getVariantByCategory(req:Request,res:Response){
    const{session_data} = req.body
    const{category,catalog_id} = session_data
    const data = await catalogService.getProductVariants(category,catalog_id)
    return res.status(200).json(data);
  }
}




  // uploadMedia = tryCatchAsync(async (req: AuthRequest, res: Response) => {
  //   const { phone_number_id, type } = req.body;
  //   console.log('Uploaded file:', req.file);
  //   console.log('Request body:', req.body);
  //   const file = req.file;

  //   if (!phone_number_id || !type || !file) {
  //     throw new HTTP400Error({ message: 'phone_number_id, type, and file are required' });
  //   }

  //   const result = await CampaignService.uploadMedia(req.companyId!, phone_number_id, file, type);
  //   return successResponse(req, res, 'Media uploaded successfully', result, HttpStatusCode.CREATED);
  // });

export default new AuthController();
