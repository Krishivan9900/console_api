import chatSessionModel from './app/models/chatSession.model';
import chatBotModel from './app/models/chatbot.model';
import chatBotNodeModel from './app/models/chatBotNode.model';
import chatBotEdgeModel from './app/models/chatBotEdge.model';
import messageService from './app/services/message.service';
import nodemailer from "nodemailer";
import axios from 'axios';
import { parsePhoneNumberFromString } from "libphonenumber-js";
import metaService from './app/services/meta.service';
import { executeNode } from './app/services/chatbot/engine/executeNode';
import catalogService from './app/services/catalog.service';
import chatbotTriggerModel from './app/models/chatbotTrigger.model';

export const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// export async function handleIncomingMessageChatBot(phoneNumberId: any, message: any) {
//   try {
//     console.log("📥 Incoming:", phoneNumberId, message);

//     const phone = message.from;

//     const incomingId =
//       message?.interactive?.button_reply?.id ||
//       message?.interactive?.list_reply?.id ||
//       null;

//     const incomingText = (
//       message?.text?.body ||
//       message?.interactive?.button_reply?.title ||
//       message?.interactive?.list_reply?.title ||
//       ""
//     ).toLowerCase().trim();

//     console.log("📩 Parsed:", { phone, incomingText });

//     // 1️⃣ Get bot
//     console.log("🔍 Finding bot for phone number:", phoneNumberId);
//     const bot: any = await chatBotModel.getPublishedBotByPhoneNumberId(phoneNumberId);
//     console.log("🤖 Found bot:", bot ? bot.name : "No bot");
//     console.log("🤖 Found bot:", bot ? bot.name : "No bot");
//     if (!bot) return null;

//     // 2️⃣ Load nodes + edges
//     const rawNodes = await chatBotNodeModel.findByChatBotId(bot.id) || [];
//     const rawEdges = await chatBotEdgeModel.findByChatBotId(bot.id) || [];

//     bot.nodes = rawNodes.map((n: any) => ({
//       ...n,
//       data: safeJSON(n.data),
//     }));

//     bot.edges = rawEdges.map((e: any) => ({
//       ...e,
//       data: safeJSON(e.data),
//     }));

//     console.log("📦 Nodes:", bot.nodes.length);
//     console.log("🔗 Edges:", bot.edges.length);

//     // console.log("Nodes", JSON.stringify(bot.nodes))
//     // console.log("Edges", JSON.stringify(bot.edges))


//     // 3️⃣ Resolve flow WITHOUT session
//     const response = resolveFlow(bot, incomingText,incomingId);
//     console.log("Response", JSON.stringify(response))

//     // 4️⃣ Send message
//     if (response) {
//       await messageService.sendChatBotMessage(phoneNumberId, phone, response);
//     } else {
//       console.log("⚠️ No response generated");
//     }

//     return response;

//   } catch (error) {
//     console.error("❌ Chatbot Error:", error);
//     return null;
//   }
// }


// function resolveFlow(bot: any, incomingText: string, incomingId?: string) {
//   incomingText = incomingText.toLowerCase().trim();
//   console.log("Incoming Id", incomingId, bot)

//   // 1️⃣ Trigger
//   const triggerNode = bot.nodes.find((n: any) => n.type === "trigger");

//   if (triggerNode) {
//     const triggerData = safeJSON(triggerNode.data);
//     const isMatch = matchTrigger(triggerData, incomingText);

//     if (isMatch) {
//       const edge = bot.edges.find((e: any) => e.source === triggerNode.id);
//       if (!edge) return null;

//       const nextNode = bot.nodes.find((n: any) => n.id === edge.target);
//       return buildResponse(nextNode);
//     }
//   }

//   // 🔥 2️⃣ MATCH USING LABEL ↔ incomingText
//   if (incomingText) {
//     const edge = bot.edges.find((e: any) => {
//       const label = (e.label || "").toLowerCase().trim();
//       const text = incomingText.toLowerCase().trim();

//       console.log("🔍 Matching:", { label, text });

//       return label === text;
//     });

//     if (edge) {
//       console.log("✅ Matched Edge:", edge);

//       const nextNode = bot.nodes.find((n: any) => n.id === edge.target);
//       return buildResponse(nextNode);
//     }
//   }

//   // 🔥 2️⃣ PRIMARY: MATCH USING incomingId
//   if (incomingId) {
//     const edge = bot.edges.find((e: any) => {
//       const handle = e?.data?.sourceHandle;   // 👈 BEST PRACTICE
//       const label = (e.label || "").toLowerCase();

//       console.log("BOT", handle, label)

//       return (
//         handle === incomingId ||             // preferred
//         label === incomingId.toLowerCase()   // fallback
//       );
//     });

//     if (edge) {
//       const nextNode = bot.nodes.find((n: any) => n.id === edge.target);
//       return buildResponse(nextNode);
//     }
//   }

//   // 3️⃣ LAST fallback → text (not recommended but okay)
//   for (const edge of bot.edges) {
//     const label = (edge.label || "").toLowerCase().trim();

//     if (label === incomingText) {
//       const nextNode = bot.nodes.find((n: any) => n.id === edge.target);
//       return buildResponse(nextNode);
//     }
//   }

//   return null;
// }


export function safeJSON(data: any) {
  try {
    return typeof data === "string" ? JSON.parse(data) : data;
  } catch {
    return {};
  }
}


// export function replaceVariables(obj:any, variables:Record<string, any>):any{
//   console.log("Variables", obj,variables)
//   console.log("Typeof",typeof obj)

//   if(typeof obj === "string"){
//     return obj.replace(/\{\{(.*?)\}\}/g,(_,key)=> {
//       console.log("key",variables[key.trim()])
//       return variables[key.trim()]?? "";
//     })
//   }

//   if(Array.isArray(obj)){
//     return obj.map(item => replaceVariables(item,variables))
//   }

//   if(obj && typeof obj === "object"){
//     const result:any = {}

//     for(const key in obj){
//       result[key] = replaceVariables(obj[key], variables)
//     }

//     return result;
//   }

//   return obj;
// }


export function normalizeRole(role: string): string {
  if (!role) return "USER";

  const normalized = role.trim().toLowerCase();

  const roleMap: Record<string, string> = {
    // Farmer
    "farmer": "farmer",
    "किसान": "farmer",
    "రైతు": "farmer",

    // Trader
    "trader": "trader",
    "व्यापारी": "trader",
    "వ్యాపారి": "trader",

    // FPO
    "fpo": "fpo",
    "రైతు ఉత్పత్తిదారుల సంస్థ": "fpo",
    "किसान उत्पादक(fpo)": "fpo",
    "రైతు ఉత్పత్తిదారు(fpo)": "fpo",

    // Transport
    "agricultural transport service": "agricultural_transport_service",
    "agri-transport": "agricultural_transport_service",
    "వ్యవసాయ రవాణా సేవలు": "agricultural_transport_service",
    "कृषि परिवहन सेवा": "agricultural_transport_service",
    "వ్యవసాయ రవాణా సేవ": "agricultural_transport_service",

    // Micro Entrepreneur
    "micro entrepreneur": "micro_entrepreneur",
    "micro-entrepreneur": "micro_entrepreneur",
    "सूक्ष्म उद्यमी": "micro_entrepreneur",
    "సూక్ష్మ వ్యాపారవేత్త": "micro_entrepreneur",

    // Machinery
    "agricultural machinery service provider": "agricultural_machinery_service_provider",
    "agri-machine": "agricultural_machinery_service_provider",
    "వ్యవసాయ యంత్రాలు": "agricultural_machinery_service_provider",
    "कृषि मशीन सेवा प्रदाता": "agricultural_machinery_service_provider",
    "వ్యవసాయ యంత్ర సేవా ప్రదాత": "agricultural_machinery_service_provider",

    // Input Supplier
    "agricultural input supplier": "agricultural_input_supplier",
    "agri input supplier": "agricultural_input_supplier",
    "వ్యవసాయ ఇన్‌పుట్లు": "agricultural_input_supplier",
    "कृषि इनपुट आपूर्तिकर्ता": "agricultural_input_supplier",
    "వ్యవసాయ ఇన్‌పుట్ సరఫరాదారు": "agricultural_input_supplier",

    // Livestock
    "livestock farmer": "livestock_farmer",
    "livestock": "livestock_farmer",
    "పశుపాలకుడు": "livestock_farmer",
    "पशुपालक": "livestock_farmer",
    "పశుపోషకుడు": "livestock_farmer",
  };

  return roleMap[normalized] ||
    (Object.values(roleMap).includes(normalized) ? normalized : role.toUpperCase());
}


export function normalizeLanguage(language: string) {
  if (!language) return "english";

  const normalized = language.trim().toLowerCase();

  const languageMap: any = {
    "english": "english",
    "en": "english",
    "eng": "english",
    "अंग्रेज़ी": "english",
    "इंग्लिश": "english",
    "ఇంగ్లీష్": "english",

    "hindi": "hindi",
    "hi": "hindi",
    "hin": "hindi",
    "हिंदी": "hindi",
    "हिन्दी": "hindi",
    "హిందీ": "hindi",

    "telugu": "telugu",
    "te": "telugu",
    "tel": "telugu",
    "तेलुगु": "telugu",
    "తెలుగు": "telugu",
    "తెలుగులో": "telugu",
  };

  return languageMap[normalized] || "english";
}

/** Read supplied address fields; coordinates are never converted into an address here. */
export function getRegistrationLocation(...records: any[]): Record<string, any> {
  const sources = records.flatMap(data => {
    if (!data || typeof data !== 'object') return [];
    const details = data.details || {};
    const company = details.company_details || data.company_details || details;
    const point = data.coordinates?.coordinates;
    const coordinates = Array.isArray(point) && point.length === 2
      ? { longitude: point[0], latitude: point[1] } : {};
    return [data.location, typeof data.address === 'object' ? data.address : { full_address: data.address }, data,
      coordinates, details.location, details.address, company.pradr, { state: company.state_info?.name }, details, company,
      data.kyc_data?.address].filter(value => value && typeof value === 'object' && !Array.isArray(value));
  });
  const pick = (...keys: string[]) => {
    for (const source of sources) {
      for (const key of keys) {
        const value = source[key];
        if ((typeof value === 'string' && value.trim()) || typeof value === 'number' && Number.isFinite(value)) {
          return typeof value === 'string' ? value.trim() : value;
        }
      }
    }
    return null;
  };
  const coordinate = (limit: number, ...keys: string[]) => {
    const raw = pick(...keys);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
  };
  const pincode = pick('pincode', 'pin_code', 'postal_code', 'postcode', 'pinc');
  return {
    full_address: pick('full_address', 'address_line', 'addr', 'address'),
    state: pick('state', 'state_in_address'),
    district: pick('district'),
    subdistrict: pick('subdistrict', 'sub_district', 'sub_distric', 'taluk', 'tehsil', 'mandal'),
    village: pick('village'),
    pincode: pincode === null ? null : String(pincode),
    latitude: coordinate(90, 'latitude', 'lat'),
    longitude: coordinate(180, 'longitude', 'lng', 'lon'),
  };
}

/** Prefer a supplied email, then a usable contact email returned with GST company details. */
export function getRegistrationEmail(...records: any[]): string | null {
  for (const data of records) {
    if (!data || typeof data !== 'object') continue;
    const sources = [data, data.details, data.company_details, data.details?.company_details, data.data?.company_details,
      data.http_response?.data, data.http_response?.data?.company_details,
      data.api_response?.data, data.api_response?.data?.company_details];
    for (const source of sources) {
      for (const contact of [source, source?.contact_details]) {
        for (const key of ['email', 'email_address', 'email_id', 'emailAddress', 'emailId']) {
          const raw = contact?.[key];
          if (typeof raw !== 'string') continue;
          const email = raw.trim();
          if (/^[^\s@*•]+@[^\s@*•]+\.[^\s@*•]+$/.test(email)) return email;
        }
      }
    }
  }
  return null;
}

export function normalizeRegistrationData(data: any): any {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const normalized = { ...data };
  const role = [data.role, data.details?.role].find(value => typeof value === 'string' && value.trim());
  const language = [data.native_language, data.details?.native_language].find(value => typeof value === 'string' && value.trim());
  if (role) normalized.role = normalizeRole(role);
  if (language) normalized.native_language = normalizeLanguage(language);
  const email = getRegistrationEmail(data);
  if (email) normalized.email = email;
  const location = getRegistrationLocation(data);
  if (Object.values(location).some(value => value !== null)) {
    normalized.location = { ...(typeof data.location === 'object' ? data.location : {}), ...location };
  }
  if (data.details && typeof data.details === 'object' && !Array.isArray(data.details)) {
    normalized.details = { ...data.details };
    if (data.details.role) normalized.details.role = normalized.role || normalizeRole(data.details.role);
    if (data.details.native_language) normalized.details.native_language = normalized.native_language;
  }
  return normalized;
}




export function replaceVariables(
  obj: any,
  variables: Record<string, any>
): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  const getValue = (key: string) => {
    key = key.trim();

    // aliases
    if (key === "data" || key === "variable") {
      // return variables?.details;
      const normalizedLanguage = normalizeLanguage(variables?.native_language)
      console.log("Variables", variables)
      return normalizeRegistrationData({
        name: variables.name,
        details: variables?.details?.company_details ?? null,
        native_language: normalizedLanguage,
        gstin: variables?.gstin,
        role: variables.role || variables.details?.role,
        email: getRegistrationEmail(variables) ?? variables.email,
        photo: variables.photo,
        chat: variables.chat,
        image_url: variables.image_url,
        voice: variables.voice,

        location: getRegistrationLocation(variables),
        phone_number: variables.phone_number,
        fpo_id: variables.fpo_id,
        parent_user_id: variables.parent_user_id ? variables.parent_user_id : variables?.api_response?.data?.parent_user_id
      });
    }

    if (key === "gstin") {
      return variables?.gstin;
    }

    // support nested paths
    return key.split(".").reduce(
      (acc: any, part: string) => acc?.[part],
      variables
    );
  };

  if (typeof obj === "string") {
    const fullMatch = obj.match(
      /^{{\s*([^}]+)\s*}}$/
    );

    // Entire value is a variable
    if (fullMatch) {
      const key = fullMatch[1];
      const value = getValue(key);

      return value !== undefined
        ? value
        : obj;
    }

    // Variable inside string
    return obj.replace(
      /{{\s*([^}]+)\s*}}/g,
      (_, key) => {
        const value = getValue(key);

        if (
          value === null ||
          value === undefined
        ) {
          return "";
        }

        if (
          typeof value === "object"
        ) {
          return JSON.stringify(value);
        }

        return String(value);
      }
    );
  }

  if (Array.isArray(obj)) {
    return obj.map(item =>
      replaceVariables(item, variables)
    );
  }

  if (typeof obj === "object") {
    const result: any = {};

    for (const [key, value] of Object.entries(
      obj
    )) {
      result[key] = replaceVariables(
        value,
        variables
      );
    }

    return result;
  }

  return obj;
}

// export function replaceVariables(
//   obj: any,
//   variables: Record<string, any>
// ): any {
//   if (obj === null || obj === undefined) {
//     return obj;
//   }

//   if (typeof obj === "string") {
//     const fullMatch = obj.match(/^{{\s*([^}]+)\s*}}$/);

//     // Handle entire variable replacement
//     if (fullMatch) {
//       const key = fullMatch[1].trim();

//       // {{data}}
//       if (key === "data") {
//         return variables?.data;
//       }

//       // {{gstin}}
//       if (key === "gstin" && variables?.data) {
//         return variables.data;
//       }

//       // nested path support
//       const value = key
//         .split(".")
//         .reduce((o: any, k: string) => o?.[k], variables);

//       return value ?? obj;
//     }

//     // Handle variables inside strings
//     return obj.replace(
//       /{{\s*([^}]+)\s*}}/g,
//       (_, key) => {
//         const variableKey = key.trim();

//         // {{gstin}}
//         if (
//           variableKey === "gstin" &&
//           variables?.data
//         ) {
//           return String(variables.data);
//         }

//         // {{data}}
//         if (variableKey === "data") {
//           return typeof variables?.data === "object"
//             ? JSON.stringify(variables.data)
//             : String(variables?.data ?? "");
//         }

//         // nested path support
//         const value = variableKey
//           .split(".")
//           .reduce(
//             (o: any, k: string) => o?.[k],
//             variables
//           );

//         return value != null ? String(value) : "";
//       }
//     );
//   }

//   if (Array.isArray(obj)) {
//     return obj.map(item =>
//       replaceVariables(item, variables)
//     );
//   }

//   if (typeof obj === "object") {
//     const result: any = {};

//     for (const [k, v] of Object.entries(obj)) {
//       result[k] = replaceVariables(v, variables);
//     }

//     return result;
//   }

//   return obj;
// }


export const downloadImage = async (mediaId: string) => {
  console.log("MediaId:", mediaId);
  try {
    const mediaUrl = metaService.handleMedia(mediaId)
    console.log("Media Url", mediaUrl)
    return mediaUrl
  } catch (error: any) {
    console.error(
      '❌ Error downloading image:',
      error.response?.status,
      error.response?.data || error.message
    );
    throw error;
  }
};


export default function sendEmail(to: string, subject: string, text: string, html?: string) {
  console.log(`📧 Sending email to ${to}: ${subject}\n${text}`);
  return transporter.sendMail({
    from: `"Your App Name" <${process.env.SMTP_USER}>`,
    to,
    subject,
    text,
    html,
  })
  // Integrate with actual email service here (e.g., SendGrid, SES)
}

export async function matchTrigger(
  phoneNumberId: string,
  text: string
) {
  const triggerWords =
    await chatbotTriggerModel.getActiveTriggers(
      phoneNumberId
    );

  if (!text) {
    return false;
  }

  const normalizedText = text
    .toString()
    .trim()
    .toLowerCase();

  return triggerWords.some(
    (keyword: string) =>
      keyword &&
      keyword.toString().trim().toLowerCase() ===
      normalizedText
  );
}



export const transformFeatures = (features: any) => {
  const limits: any = {};
  const usage: any = {};

  Object.keys(features).forEach((key) => {
    limits[key] = {
      limit: features[key].limit_value
    };

    usage[key] = 0; // initialize usage
  });

  return { limits, usage };
};



// async function startNewFlow(bot: any, phone: string, text: string) {
//   const triggerNode = bot.nodes.find((n: any) => n.type === "trigger");
//   if (!triggerNode) return null;

//   const isMatch = matchTrigger(triggerNode.data, text);
//   if (!isMatch) return null;

//   const edge = bot.edges.find((e: any) => e.source === triggerNode.id);
//   if (!edge) return null;

//   const nextNode = bot.nodes.find((n: any) => n.id === edge.target);
//   if (!nextNode) return null;

//   // create session
//   await chatSessionModel.create({
//     chatBotId: bot.id,
//     phone_number: phone,
//     last_node_id: nextNode.id,
//     last_message: text,
//   });

//   return buildResponse(nextNode);
// }


function parseJSON(data: any) {
  try {
    return typeof data === 'string' ? JSON.parse(data) : data;
  } catch {
    return {};
  }
}

export { normalizeRegistrationPhoneNumber } from './phone';

export const normalizePhoneNumber = (
  phone: string,
  countryCode?: string
) => {

  if (!phone) return null;

  let cleaned = String(phone)
    .replace(/[^\d+]/g, "")
    .trim();

  // Remove leading zero
  if (cleaned.startsWith("0")) {
    cleaned = cleaned.slice(1);
  }

  let parsed;

  // Already international
  if (cleaned.startsWith("+")) {

    parsed = parsePhoneNumberFromString(cleaned);

  } else {

    // Example: 919876543210
    if (cleaned.startsWith("91") && cleaned.length === 12) {
      cleaned = "+" + cleaned;
      parsed = parsePhoneNumberFromString(cleaned);
    } else {

      // Use provided country
      parsed = parsePhoneNumberFromString(
        cleaned,
        countryCode as any || "IN"
      );
    }
  }

  if (!parsed || !parsed.isValid()) {
    return null;
  }

  return {
    number: parsed.number,
    country: parsed.country,
    countryCode: parsed.countryCallingCode,
  };
};

// export function replaceBodyVariables(
//   text: string,
//   variables: Record<string, any> = {}
// ): string {
//   if (!text) return "";

//   return text.replace(/\{\{(.*?)\}\}/g, (_, variablePath) => {
//     const value = variablePath
//       .trim()
//       .split(".")
//       .reduce(
//         (obj: any, key: string) => obj?.[key],
//         variables
//       );

//     console.log(
//       `Variable: ${variablePath} =>`,
//       value
//     );

//     return value !== undefined && value !== null
//       ? String(value)
//       : "";
//   });
// }


function getNestedValue(obj: any, path: string) {
  return path.split(".").reduce((current, key) => {
    return current?.[key];
  }, obj);
}

// function replaceBodyVariables(text: string, variables: any) {
//   console.log('Variable',variables)
//   return text.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
//     const value = getNestedValue(variables, key.trim());

//     return value !== undefined && value !== null
//       ? String(value)
//       : "";
//   });
// }

function replaceBodyVariables(text: string, variables: any): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
    // Registration success nodes can request the full account summary explicitly.
    if (path.trim() === 'registration_welcome') return buildWelcomeMessage(variables);
    const value = getNestedValue(variables, path.trim());
    return value === undefined || value === null ? "" : String(value);
  });
}

function buildWelcomeMessage(variables: any): string {
  const details = variables?.details || {};
  const response = variables?.http_response || variables?.api_response || {};
  const responseData = response.data || {};
  const user = responseData.data || responseData;
  const registeredUser = response.user || {};
  const kyc = registeredUser.kyc_data || user.kyc_data || {};
  const companyDetails = {
    ...(user.details || {}),
    ...(user.company_details || {}),
    ...(variables?.company_details || {}),
    ...(variables?.data?.company_details || {}),
    ...(details.company_details || {}),
  };

  const name = variables?.name || details.name || registeredUser.name || registeredUser.first_name || user.name || user.first_name;
  const email = getRegistrationEmail(variables, registeredUser, user, companyDetails);
  const phone = variables?.phone_number || details.phone_number || registeredUser.phone || registeredUser.mobile_number || user.phone_number || user.phone || user.mobile_number;
  const gstin = variables?.gstin || details.gstin || user.gstin || kyc.gst_no;
  const role = variables?.role || details.role || registeredUser.role_type || registeredUser.role || user.role_type || user.role;
  const companyName = companyDetails.legal_name || companyDetails.trade_name || kyc.company_name;
  const pan = companyDetails.pan || kyc.pan_no;
  const location = getRegistrationLocation(variables, registeredUser, user, { details: companyDetails }, { address: kyc.address });
  const language = normalizeLanguage(variables?.native_language || details.native_language ||
    registeredUser.native_language || registeredUser.primary_language || user.native_language || user.primary_language);
  const messages = {
    english: {
      heading: '🌱 *Welcome to Krishivan!*', greeting: (value: string) => `Hello ${value || 'there'},`,
      created: 'Your account has been created successfully. 🎉', details: '*Your account details*',
      company: 'Company', email: 'Email', phone: 'Phone', gstin: 'GSTIN', pan: 'PAN', role: 'Role',
      address: 'Address', state: 'State', district: 'District', subdistrict: 'Subdistrict', village: 'Village', pincode: 'Pincode',
      login: '*Login to your account*', password: '*Temporary password:* 123456',
      reminder: 'Please change your password after your first login and keep your credentials private.',
      closing: 'Welcome aboard! 🤝',
    },
    hindi: {
      heading: '🌱 *कृषिवन में आपका स्वागत है!*', greeting: (value: string) => value ? `नमस्ते ${value},` : 'नमस्ते,',
      created: 'आपका खाता सफलतापूर्वक बन गया है। 🎉', details: '*आपके खाते की जानकारी*',
      company: 'कंपनी', email: 'ईमेल', phone: 'फ़ोन', gstin: 'जीएसटीआईएन', pan: 'पैन', role: 'भूमिका',
      address: 'पता', state: 'राज्य', district: 'ज़िला', subdistrict: 'उपज़िला', village: 'गाँव', pincode: 'पिनकोड',
      login: '*अपने खाते में लॉग इन करें*', password: '*अस्थायी पासवर्ड:* 123456',
      reminder: 'पहली बार लॉग इन करने के बाद कृपया अपना पासवर्ड बदलें और अपनी लॉगिन जानकारी गोपनीय रखें।',
      closing: 'हमारे साथ जुड़ने के लिए धन्यवाद! 🤝',
    },
    telugu: {
      heading: '🌱 *కృషివన్‌కు స్వాగతం!*', greeting: (value: string) => value ? `నమస్కారం ${value},` : 'నమస్కారం,',
      created: 'మీ ఖాతా విజయవంతంగా సృష్టించబడింది. 🎉', details: '*మీ ఖాతా వివరాలు*',
      company: 'సంస్థ', email: 'ఈమెయిల్', phone: 'ఫోన్', gstin: 'జీఎస్టీఐఎన్', pan: 'పాన్', role: 'పాత్ర',
      address: 'చిరునామా', state: 'రాష్ట్రం', district: 'జిల్లా', subdistrict: 'ఉప జిల్లా', village: 'గ్రామం', pincode: 'పిన్‌కోడ్',
      login: '*మీ ఖాతాలో లాగిన్ అవ్వండి*', password: '*తాత్కాలిక పాస్‌వర్డ్:* 123456',
      reminder: 'మొదటిసారి లాగిన్ అయిన తర్వాత మీ పాస్‌వర్డ్‌ను మార్చండి. మీ లాగిన్ వివరాలను గోప్యంగా ఉంచండి.',
      closing: 'మాతో చేరినందుకు ధన్యవాదాలు! 🤝',
    },
  };
  const roleNames: Record<string, Record<string, string>> = {
    hindi: {
      farmer: 'किसान', trader: 'व्यापारी', fpo: 'किसान उत्पादक संगठन (FPO)',
      agricultural_transport_service: 'कृषि परिवहन सेवा', micro_entrepreneur: 'सूक्ष्म उद्यमी',
      agricultural_machinery_service_provider: 'कृषि मशीन सेवा प्रदाता',
      agricultural_input_supplier: 'कृषि इनपुट आपूर्तिकर्ता', livestock_farmer: 'पशुपालक',
    },
    telugu: {
      farmer: 'రైతు', trader: 'వ్యాపారి', fpo: 'రైతు ఉత్పత్తిదారుల సంస్థ (FPO)',
      agricultural_transport_service: 'వ్యవసాయ రవాణా సేవలు', micro_entrepreneur: 'సూక్ష్మ వ్యాపారవేత్త',
      agricultural_machinery_service_provider: 'వ్యవసాయ యంత్ర సేవా ప్రదాత',
      agricultural_input_supplier: 'వ్యవసాయ ఇన్‌పుట్ సరఫరాదారు', livestock_farmer: 'పశుపాలకుడు',
    },
  };
  const copy = messages[language as keyof typeof messages];
  const displayedRole = role && (language === 'english'
    ? String(role).replace(/_/g, ' ').toUpperCase()
    : roleNames[language]?.[normalizeRole(String(role))] || String(role));

  const detailLines = [
    companyName && `*${copy.company}:* ${companyName}`,
    email && `*${copy.email}:* ${email}`,
    phone && `*${copy.phone}:* ${phone}`,
    gstin && `*${copy.gstin}:* ${gstin}`,
    pan && `*${copy.pan}:* ${pan}`,
    role && `*${copy.role}:* ${displayedRole}`,
    location.full_address && `*${copy.address}:* ${location.full_address}`,
    location.state && `*${copy.state}:* ${location.state}`,
    location.district && `*${copy.district}:* ${location.district}`,
    location.subdistrict && `*${copy.subdistrict}:* ${location.subdistrict}`,
    location.village && `*${copy.village}:* ${location.village}`,
    location.pincode && `*${copy.pincode}:* ${location.pincode}`,
  ].filter(Boolean);

  return [
    copy.heading,
    "",
    copy.greeting(name),
    copy.created,
    "",
    copy.details,
    ...detailLines,
    "",
    copy.login,
    "https://fpo-krishivan.web.app/login",
    copy.password,
    "",
    copy.reminder,
    "",
    copy.closing,
  ].join("\n");
}

export async function endSession(sessionId: string) {
  return await chatSessionModel.update(sessionId, {
    active: false,
    current_node_id: null,
    updated_at: new Date(),
  });
}


export async function buildProductMessage(category: string, catalog_id: string) {
  console.log("Build Product Message", catalog_id, category)
  const getProductVariants = await catalogService.getProductVariants(category, catalog_id)
  console.log("Product Variants", getProductVariants)
}

export async function buildResponse(node: any, session?: any, bot?: any) {
  console.log('NextNode', JSON.stringify(node))
  console.log()
  const data = safeJSON(node.data);


  // if (node.type === "message") {
  //   return {
  //     type: "text",
  //     text: data.text || "",
  //   };
  // }

  const key = data?.key;
  console.log("Data flow", data, key)

  if (key === "@whatsapp/ask-question") {
    return {
      type: "text",
      text: replaceBodyVariables(
        data?.attributes?.message?.text?.body || "Please enter value",
        session?.variables || {}
      )
    };
  }

if (data.key === "@whatsapp/send-cta-message") {
  const attrs = data.attributes || {};

  const interactiveData = attrs.message?.interactive || {};

  const header = interactiveData.header || {};
  const body = interactiveData.body || {};
  const footer = interactiveData.footer || {};
  const parameters = interactiveData.action?.parameters || {};

  const interactive: any = {
    type: "cta_url",

    body: {
      text: body.text || "",
    },

    action: {
      name: "cta_url",
      parameters: {
        display_text: parameters.display_text || "Open",
        url: parameters.url || "",
      },
    },
  };

  // -----------------------------------------
  // Add header ONLY if type is valid
  // Meta does NOT support "none"
  // -----------------------------------------
  const validHeaderTypes = [
    "text",
    "image",
    "video",
    "document",
  ];

  if (
    header.type &&
    validHeaderTypes.includes(header.type)
  ) {
    if (header.type === "text") {
      interactive.header = {
        type: "text",
        text: header.text || "",
      };
    }

    if (
      header.type === "image" &&
      header.image
    ) {
      interactive.header = {
        type: "image",
        image: header.image,
      };
    }

    if (
      header.type === "video" &&
      header.video
    ) {
      interactive.header = {
        type: "video",
        video: header.video,
      };
    }

    if (
      header.type === "document" &&
      header.document
    ) {
      interactive.header = {
        type: "document",
        document: header.document,
      };
    }
  }

  // -----------------------------------------
  // Footer is optional
  // Don't send footer.text = ""
  // -----------------------------------------
  if (footer.text?.trim()) {
    interactive.footer = {
      text: footer.text,
    };
  }

  return {
    type: "interactive",
    interactive,
  };
}

  if (key === "@whatsapp/stop-chatbot") {
    if (session?.id) {
      await endSession(session.id);
    }

    return {
      type: "text",
      text:
        data?.attributes?.message ||
        "Thank you. This conversation has been closed.",
      stopChatbot: true,
    };
  }

  if (key === "@whatsapp/send-text-message") {
    // A body configured on the flow node takes precedence over this default.
    const configuredBody = data?.attributes?.message?.text?.body;
    const text = typeof configuredBody === 'string' && configuredBody.trim()
      ? replaceBodyVariables(configuredBody, session?.variables || {})
      : buildWelcomeMessage(session?.variables || {});

    console.log('Next Node',node?.nextNodeId)
    return {
      type: "text",
      text,
      nextNodeId: node?.nextNodeId || null,
    };
  }

  //   if (key === "@whatsapp/send-text-message") {
  //     const text = `Welcome to Krishivan Organization! 🎉

  // Hello Ritesh,

  // Your account has been created successfully .

  // 📧 Email: ritesh45@gmail.com
  //    Company Name: JAIVIK KISAN UPAJ PRODUCER COMPANY LIMITED
  //    PAN Number: AAECJ8814A
  //    Address: 881, SETELIGHT JUCTION, A.B. ROAD, INDORE, Indore, Madhya Pradesh, 452010
  // 🔐 Password: 123456
  // 👤 Role: FPO

  // Your Information has been verified through your gst number

  // You can login using the link below:

  // 🔗 https://fpo-krishivan.web.app/login

  // Please keep your login credentials safe.

  // Welcome aboard! 🚀`;

  //     console.log("TEXT", text);

  //     return {
  //       type: "text",
  //       text,
  //     };
  //   }

  // if (key === "@whatsapp/send-product-message") {
  //   //Get catalog_id from message.action.catalog_id
  //   //Get category from session.variable.category
  //   //call catalogService pass the catalog_id,category
  //   // create function buildProductMessage 
  //   console.log("Product session", session.variables.category)
  //   console.log("Product node", data.attributes.message.interactive.action.catalog_id)
  //   const catalog_id = data.attributes.message.interactive.action.catalog_id
  //   const category = session.variables.category
  //   const productVariants = await catalogService.getProductVariants(category, catalog_id)
  //   const productItems = productVariants.data?.map((id: string) => {
  //     return {
  //       product_retailer_id: id
  //     };
  //   })

  //   console.log("Product Items", productItems)

  //   return {
  //     type: "interactive",

  //     interactive: {
  //       type: "product_list",

  //       header: {
  //         type: "text",
  //         text: "View Krishivan Catalog"
  //       },

  //       body: {
  //         text: "Select a product to place order"
  //       },
  //       action: {
  //         catalog_id: catalog_id,
  //         sections: [
  //           {
  //             title: `View selected ${category}`,
  //             product_items: productItems
  //           }
  //         ]
  //       }

  //     }

  //   }
  // }

  if (key === "@whatsapp/send-product-message") {
    //Get catalog_id from message.action.catalog_id
    //Get category from session.variable.category
    //call catalogService pass the catalog_id,category
    // create function buildProductMessage 
    console.log("Product node", session.variables)
    const catalog_id = '795853123055079'
    const product_name = session.variables.product_name
    console.log("Product Name", product_name)
    const productVariants = await catalogService.getProductVariants(product_name, catalog_id)
    const productItems = productVariants.data?.map((id: string) => {
      return {
        product_retailer_id: id
      };
    })

    console.log("Product Items", productItems)

    return {
      type: "interactive",

      interactive: {
        type: "product_list",

        header: {
          type: "text",
          text: "View Krishivan Catalog"
        },

        body: {
          text: "Select a product to place order"
        },
        action: {
          catalog_id: catalog_id,
          sections: [
            {
              title: `View Krishivan Products`,
              product_items: productItems
            }
          ]
        }

      }

    }
  }

  // Button Interactive  
  if (key === "@whatsapp/send-button-message") {
    const interactiveData =
      data?.attributes?.message?.interactive || {};

    const interactive: any = {
      type: "button",

      body: {
        text:
          interactiveData?.body?.text ||
          data?.text ||
          "",
      },

      footer: {
        text:
          interactiveData?.footer?.text || "",
      },

      action: {
        buttons: (
          interactiveData?.action?.buttons ||
          data?.buttons ||
          []
        ).map((btn: any, i: number) => ({
          type: "reply",

          reply: {
            id:
              btn?.reply?.id ||
              btn?.id ||
              `btn_${i}`,

            title:
              btn?.reply?.title ||
              btn?.title ||
              String(btn),
          },
        })),
      },
    };

    // Add header only if text exists
    const headerText =
      interactiveData?.header?.text;

    if (headerText?.trim()) {
      interactive.header = {
        type: "text",
        text: headerText,
      };
    }

    return {
      type: "interactive",
      interactive,
    };
  }

  if (key === "@whatsapp/ask-location") {
    return {
      type: "interactive",

      interactive: {
        type: "location_request_message",

        body: {
          text:
            data?.attributes?.message?.text?.body ||
            "Please share location"
        },

        action: {
          name: "send_location"
        }
      }
    };
  }


  // 📋 LIST MESSAGE BUILDER
  if (key === "@whatsapp/send-list-message") {
    const interactiveData =
      data.attributes?.message?.interactive || {};

    const sections =
      interactiveData.action?.sections || [];

    const interactive: any = {
      type: "list",

      body: interactiveData.body || {
        text: "Choose an option",
      },

      footer: interactiveData.footer,

      action: {
        button:
          interactiveData.action?.button ||
          "Select Option",

        sections: sections.map((section: any) => ({
          title: section.title || "Options",

          rows: (section.rows || []).map((row: any) => ({
            id: row.id,
            title: row.title,
            description: row.description || "",
          })),
        })),
      },
    };

    if (
      interactiveData.header &&
      interactiveData.header.type &&
      ["text", "image", "video", "document"].includes(
        interactiveData.header.type
      )
    ) {
      interactive.header = interactiveData.header;
    }

    return {
      type: "interactive",
      interactive,
    };
  }

  // 🔗 CTA URL BUTTON
  // if (type === "cta_url") {
  //   const interactive: any = {
  //     type: "cta_url",
  //     body: {
  //       text: data.text || ""
  //     },
  //     footer: data.footer || undefined,
  //     action: {
  //       name: "cta_url",
  //       parameters: {
  //         display_text: data.ctaDisplayText || "Open",
  //         url: data.ctaUrl
  //       }
  //     }
  //   };

  //   // Optional Header
  //   if (data.headerType === 'image' && data.headerMedia) {
  //     interactive.header = {
  //       type: "image",
  //       image: {
  //         link: data.headerMedia
  //       }
  //     };
  //   } else if (data.headerType === 'text' && data.header) {
  //     interactive.header = {
  //       type: "text",
  //       text: data.header
  //     };
  //   }
  //   return {
  //     type: "interactive",
  //     interactive
  //   }
  // }

  // // 🎞️ CAROUSEL (Meta = "product" or "generic template")
  // if (type === "carousel") {
  //   return {
  //     type: "interactive",
  //     interactive: {
  //       type: "carousel", // or "catalog_message" depending on API
  //       body: {
  //         text: data.text || "Browse items"
  //       },
  //       action: {
  //         cards: data.carouselCards || []
  //       }
  //     }
  //   };
  // }

  // // 🖼️ MEDIA MESSAGE (image header)
  // if (type === "media") {
  //   return {
  //     type: "image",
  //     image: {
  //       link: data.mediaUrl,
  //       caption: data.text || ""
  //     }
  //   };
  // }


  return null;
}
