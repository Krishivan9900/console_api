import { Request, Response, NextFunction } from "express";
import HTTP401Error from "../exceptions/HTTP401Error";
import jwt from "jsonwebtoken";
import userModel from "@surefy/console/app/models/user.model";

export interface JWTAuthRequest extends Request {
  userId?: string;
  companyId?: string;

  userRole?: string;
  roleId?: string;
  roleType?: string;
  userRoleType?: string;

  email?: string;
  phone?: string;
  name?: string;

  nativeLanguage?: string | null;

  imageUrl?: string | null;
  avatar?: string | null;

  location?: any;
  state?: string | null;
  stateInfo?: any;

  parentUserId?: string | null;
}

interface JWTPayload {
  userId: string;
  id?: string;
  role?: string;
  type?: string;

  iat?: number;
  exp?: number;
}

/**
 * JWT Authentication middleware
 *
 * Flow:
 * 1. Verify access token
 * 2. Get userId from JWT
 * 3. Query PostgreSQL using userId
 * 4. Build complete user details
 * 5. Attach user details to req
 */
export const jwtAuthMiddleware = async (
  req: JWTAuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // --------------------------------------------------
    // 1. Get Authorization header
    // --------------------------------------------------

    const authHeader = req.headers.authorization;

    console.log(
      "JWT Auth Middleware - Authorization header:",
      authHeader
    );

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new HTTP401Error({
        message:
          "No token provided. Authorization header required",
      });
    }

    const token = authHeader.substring(7).trim();

    if (!token) {
      throw new HTTP401Error({
        message: "Invalid token format",
      });
    }

    // --------------------------------------------------
    // 2. Verify JWT
    // --------------------------------------------------

    // const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';
    const JWT_SECRET = 'your_jwt_secret';

    let jwtPayload: JWTPayload;

    try {
      jwtPayload = jwt.verify(
        token,
        JWT_SECRET
      ) as JWTPayload;

      console.log("JWT Payload:", jwtPayload);
    } catch (error) {
      console.error(
        "JWT verification failed:",
        error
      );

      throw new HTTP401Error({
        message: "Invalid or expired token",
      });
    }

    // --------------------------------------------------
    // 3. Get userId from JWT
    // --------------------------------------------------

    const tokenUserId = jwtPayload.userId;

    if (!tokenUserId) {
      throw new HTTP401Error({
        message: "User ID missing from access token",
      });
    }

    console.log(
      "User ID from Access Token:",
      tokenUserId
    );

    // --------------------------------------------------
    // 4. Query user from PostgreSQL
    // --------------------------------------------------

    const userDetails =
      await userModel.findByUserId(tokenUserId);

    if (!userDetails) {
      throw new HTTP401Error({
        message: "User not found",
      });
    }

    console.log(
      "User Details from PostgreSQL:",
      userDetails
    );

    // --------------------------------------------------
    // 5. Build new user context
    //
    // IMPORTANT:
    // We are no longer using the JWT's role/id/etc.
    // for application data.
    //
    // PostgreSQL is the source of truth.
    // --------------------------------------------------

    const decoded = {
      userId: userDetails.id,

      companyId: userDetails.company_id,

      name: userDetails.name,

      email: userDetails.email,

      phone: userDetails.phone,

      role: userDetails.role,

      status: userDetails.status,

      parentUserId: userDetails.parent_user_id,

      user_id: userDetails.user_id,

      avatar: userDetails.avatar,

      permissions: userDetails.permissions,

      settings: userDetails.settings,

      lastLoginAt: userDetails.last_login_at,

      lastLoginIp: userDetails.last_login_ip,

      nativeLanguage:
        userDetails.native_language,

      roleId: userDetails.role_id,

      userRole:
        userDetails.user_role,

      imageUrl:
        userDetails.image_url,

      location:
        userDetails.location,

      state:
        userDetails.state,

      stateInfo:
        userDetails.state_info,

      roleType:
        userDetails.role_type,

      createdAt:
        userDetails.created_at,

      updatedAt:
        userDetails.updated_at,
    };

    // --------------------------------------------------
    // 6. Attach user details to request
    // --------------------------------------------------

    req.userId = decoded.userId;

    req.companyId = decoded.companyId;

    req.userRole = decoded.role;

    req.roleId = decoded.roleId;

    req.roleType = decoded.roleType;

    req.userRoleType = decoded.userRole;

    req.email = decoded.email;

    req.phone = decoded.phone;

    req.name = decoded.name;

    req.nativeLanguage =
      decoded.nativeLanguage;

    req.imageUrl =
      decoded.imageUrl;

    req.avatar =
      decoded.avatar;

    req.location =
      decoded.location;

    req.state =
      decoded.state;

    req.stateInfo =
      decoded.stateInfo;

    req.parentUserId =
      decoded.parentUserId;

    // --------------------------------------------------
    // 7. Debug
    // --------------------------------------------------

    console.log(
      "Redesigned User Context:",
      decoded
    );

    console.log(
      "Request User Details:",
      {
        userId: req.userId,
        companyId: req.companyId,

        name: req.name,
        email: req.email,
        phone: req.phone,

        role: req.userRole,
        roleId: req.roleId,
        roleType: req.roleType,
        userRoleType: req.userRoleType,

        nativeLanguage:
          req.nativeLanguage,

        imageUrl: req.imageUrl,
        avatar: req.avatar,

        location: req.location,

        state: req.state,
        stateInfo: req.stateInfo,

        parentUserId:
          req.parentUserId,
      }
    );

    // --------------------------------------------------
    // 8. Continue
    // --------------------------------------------------

    next();

  } catch (error) {
    next(error);
  }
};


/**
 * Role-based authorization middleware
 *
 * Usage:
 *
 * requireRole("admin")
 * requireRole("admin", "fpo")
 */
export const requireRole = (
  ...allowedRoles: string[]
) => {
  return (
    req: JWTAuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      if (!req.userRole) {
        throw new HTTP401Error({
          message:
            "No user role found in request",
        });
      }

      if (
        !allowedRoles.includes(req.userRole)
      ) {
        throw new HTTP401Error({
          message:
            `Access denied. Required role: ${allowedRoles.join(
              " or "
            )}`,
        });
      }

      next();

    } catch (error) {
      next(error);
    }
  };
};


/**
 * Optional JWT authentication middleware
 *
 * If token exists:
 *    Verify token
 *    Query PostgreSQL
 *    Attach complete user details
 *
 * If token doesn't exist:
 *    Continue without authentication
 */
export const optionalJWTAuthMiddleware = async (
  req: JWTAuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader =
      req.headers.authorization;

    if (
      authHeader &&
      authHeader.startsWith("Bearer ")
    ) {
      const token =
        authHeader.substring(7).trim();

      if (token) {
        const JWT_SECRET =
          // process.env.JWT_SECRET ||
          "your_jwt_secret";

        try {
          // -----------------------------------------
          // Verify JWT
          // -----------------------------------------

          const jwtPayload =
            jwt.verify(
              token,
              JWT_SECRET
            ) as JWTPayload;

          // -----------------------------------------
          // Get userId from JWT
          // -----------------------------------------

          if (!jwtPayload.userId) {
            return next();
          }

          // -----------------------------------------
          // Get complete user from PostgreSQL
          // -----------------------------------------

          const userDetails =
            await userModel.findByUserId(
              jwtPayload.userId
            );

          if (!userDetails) {
            return next();
          }

          // -----------------------------------------
          // Attach PostgreSQL user details
          // -----------------------------------------

          req.userId =
            userDetails.id;

          req.companyId =
            userDetails.company_id;

          req.userRole =
            userDetails.role;

          req.roleId =
            userDetails.role_id;

          req.roleType =
            userDetails.role_type;

          req.userRoleType =
            userDetails.user_role;

          req.email =
            userDetails.email;

          req.phone =
            userDetails.phone;

          req.name =
            userDetails.name;

          req.nativeLanguage =
            userDetails.native_language;

          req.imageUrl =
            userDetails.image_url;

          req.avatar =
            userDetails.avatar;

          req.location =
            userDetails.location;

          req.state =
            userDetails.state;

          req.stateInfo =
            userDetails.state_info;

          req.parentUserId =
            userDetails.parent_user_id;

          console.log(
            "Optional JWT - User Details:",
            {
              userId: req.userId,
              companyId: req.companyId,
              name: req.name,
              email: req.email,
              phone: req.phone,
              role: req.userRole,
              roleId: req.roleId,
              roleType: req.roleType,
              userRoleType:
                req.userRoleType,
            }
          );

        } catch (error) {
          // Optional authentication:
          // invalid token/user should not
          // block the request.
          console.log(
            "Optional JWT validation failed"
          );
        }
      }
    }

    next();

  } catch (error) {
    next(error);
  }
};