import axios from 'axios';
import chatSessionModel from "@surefy/console/app/models/chatSession.model";
import { buildResponse } from "@surefy/console/utils";
import { replaceVariables } from '@surefy/console/utils';
import contactTagModel from '@surefy/console/app/models/contactTag.model';
import contactModel from '@surefy/console/app/models/contact.model';
import contactTagRelationModel from '@surefy/console/app/models/contactTagRelation.model';
import columnModel from '@surefy/console/app/models/column.model';
import { evaluateConditions, getConditionBranch, getConditionValue } from './condition.logic';


export const endSession = async (
    sessionId: string
): Promise<void> => {
    await chatSessionModel.update(sessionId, {
        active: false,
        current_node_id: null,
        completed_at: new Date(),
    });
};

export const executeNode = async ({
    bot,
    session,
    currentNode
}: any): Promise<any> => {
    if (!currentNode) return null;

    const data = currentNode.data
    const key = data?.key

    console.log("EXECUTING NODE:", key, data, session)

    /**
     * HTTP Node
     */
    if (key === "@http/http-request") {
        try {

            let requestBody = data?.attributes?.body;
            let requestHeaders = data?.attributes?.headers || {};
            let requestParams = data?.attributes?.params || {};

            // Parse body
            if (typeof requestBody === "string") {
                try {
                    requestBody = JSON.parse(requestBody);
                } catch {
                    // Keep as raw string
                }
            }

            // Parse headers
            if (typeof requestHeaders === "string") {
                try {
                    requestHeaders = JSON.parse(requestHeaders);
                } catch {
                    requestHeaders = {};
                }
            }

            // Parse params
            if (typeof requestParams === "string") {
                try {
                    requestParams = JSON.parse(requestParams);
                } catch {
                    requestParams = {};
                }
            }

            console.log("Session", session.variables)

            // Replace variables
            requestBody = replaceVariables(
                requestBody,
                session.variables || {}
            );

            requestHeaders = replaceVariables(
                requestHeaders,
                session.variables || {}
            );

            requestParams = replaceVariables(
                requestParams,
                session.variables || {}
            );

            /**
             * Convert
             * [
             *   { key: "Content-Type", value: "application/json" }
             * ]
             *
             * =>
             *
             * {
             *   "Content-Type":"application/json"
             * }
             */
            if (Array.isArray(requestHeaders)) {
                requestHeaders = requestHeaders.reduce(
                    (acc: Record<string, any>, item: any) => {
                        if (
                            item &&
                            typeof item.key === "string" &&
                            item.key.trim()
                        ) {
                            acc[item.key] = item.value;
                        }
                        return acc;
                    },
                    {}
                );
            }

            console.log("HTTP REQUEST");
            console.log({
                method: data?.attributes?.method || "GET",
                url: data?.attributes?.url,
                headers: requestHeaders,
                params: requestParams,
                body: requestBody
            });

            const response = await axios({
                method: data?.attributes?.method || "GET",
                url: data?.attributes?.url,
                headers: requestHeaders,
                params: requestParams,
                data: requestBody,
                timeout: 30000,
                validateStatus: () => true
            });

            console.log("HTTP STATUS:", response.status);
            console.log("HTTP RESPONSE:", response.data);

            // Treat non-success status as error
            if (response.status >= 400) {
                throw Object.assign(
                    new Error(`Request failed with status ${response.status}`),
                    { response }
                );
            }

            const updatedVariables = {
                ...(session.variables || {}),
                http_response: response.data,
                http_status: response.status,
                http_headers: response.headers,
                http_error: null
            };

            console.log('Update variables', updatedVariables)

            const edge = bot.edges.find(
                (e: any) => e.source === currentNode.id
            );

            if (!edge) {
                await endSession(session.id);
                console.log(
                    "No outgoing edge found from HTTP node"
                );
                return null;
            }

            const nextNode = bot.nodes.find(
                (n: any) => n.id === edge.target
            );

            if (!nextNode) {
                console.log("Next node not found");
                return null;
            }

            await chatSessionModel.update(session.id, {
                current_node_id: nextNode.id,
                variables: updatedVariables
            });

            return await executeNode({
                bot,
                session: {
                    ...session,
                    current_node_id: nextNode.id,
                    variables: updatedVariables
                },
                currentNode: nextNode
            });

        } catch (error: any) {

            console.error("HTTP NODE ERROR");

            // Log the endpoint without query parameters or URL credentials.
            let endpoint = "(invalid URL)";
            try {
                const url = new URL(data?.attributes?.url);
                endpoint = `${url.origin}${url.pathname}`;
            } catch {}
            console.error("Request:", {
                nodeId: currentNode.id,
                method: data?.attributes?.method || "GET",
                endpoint,
            });

            if (error.response) {
                console.error("Status:", error.response.status);
                console.error("Request ID:",
                    error.response.headers?.["rndr-id"] ||
                    error.response.headers?.["cf-ray"] ||
                    error.response.headers?.["x-request-id"] ||
                    null
                );
            }

            console.error("Message:", error.message);

            const updatedVariables = {
                ...(session.variables || {}),
                http_error: error.message,
                http_status: error.response?.status ?? null,
                http_response: error.response?.data && typeof error.response.data === "object"
                    ? error.response.data
                    : null,
                http_headers: error.response?.headers || {},
            };

            await chatSessionModel.update(session.id, {
                variables: updatedVariables
            });

            return {
                type: "text",
                text: error.response?.status >= 500
                    ? "Our service is temporarily unavailable. Please try again in a few minutes."
                    : error.code === "ECONNABORTED" || error.code === "ETIMEDOUT"
                        ? "The service took too long to respond. Please try again in a few minutes."
                        : "We could not complete this step. Please try again later."
            };
        }
    }

    /**
     * CONDITION Node
     */
    if (key === "@condition/condition-action") {
        const updateVariable: Record<string, any> = {};
        const conditionVariable = typeof data?.attributes?.variable === 'string'
            ? data.attributes.variable.trim().replace(/^\{\{\s*|\s*\}\}$/g, '').trim()
            : '';
        const variables = session.variables || {};
        const responseData = variables.http_response?.data;

        if (conditionVariable) {
            const value = getConditionValue(responseData, conditionVariable);
            if (value !== undefined) {
                updateVariable[conditionVariable] = value;
            }
        }

        const extractedVariables = { ...variables, ...updateVariable };
        const mergedVariables = {
            ...extractedVariables,
            api_response: variables.http_response ?? variables.api_response,
            gstin: responseData?.gstin !== undefined ? responseData.gstin : extractedVariables.gstin,
            valid: responseData?.valid !== undefined ? responseData.valid : extractedVariables.valid,
            data: {
                ...variables.data,
                ...(responseData?.company_details !== undefined
                    ? { company_details: responseData.company_details }
                    : {}),
            },
            details: {
                ...variables.details,
                ...(responseData?.company_details !== undefined
                    ? { company_details: responseData.company_details }
                    : {}),
                gstin: extractedVariables.gstin ?? variables.details?.gstin,
                email: extractedVariables.email ?? variables.details?.email,
                name: extractedVariables.name ?? variables.details?.name,
                role: extractedVariables.role ?? variables.details?.role,
                photo: extractedVariables.photo ?? variables.details?.photo,
                location: {
                    ...variables.details?.location,
                    ...(extractedVariables.latitude !== undefined ? { latitude: extractedVariables.latitude } : {}),
                    ...(extractedVariables.longitude !== undefined ? { longitude: extractedVariables.longitude } : {}),
                },
                phone_number: extractedVariables.phone_number ?? variables.details?.phone_number,
                parent_user_id: extractedVariables.parent_user_id !== undefined
                    ? extractedVariables.parent_user_id
                    : variables.details?.parent_user_id,
            },
        };
        let evaluation: boolean;
        let matchingEdges: any[];
        try {
            evaluation = evaluateConditions(data.attributes, mergedVariables);
            matchingEdges = bot.edges.filter((edge: any) =>
                edge.source === currentNode.id && getConditionBranch(edge) === evaluation
            );
        } catch (error: any) {
            console.error('CONDITION NODE ERROR', { nodeId: currentNode.id, message: error.message });
            await endSession(session.id);
            return { type: 'text', text: 'We could not continue this conversation. Please try again later.' };
        }

        // Duplicate saved edges are harmless when they all lead to the same node.
        const matchingTargets = [...new Set(matchingEdges.map((edge: any) => edge.target))];
        const nextNode = matchingTargets.length === 1
            ? bot.nodes.find((node: any) => node.id === matchingTargets[0])
            : null;
        console.log('CONDITION RESULT', { nodeId: currentNode.id, evaluation, nextNodeId: nextNode?.id });

        if (!nextNode) {
            console.error('CONDITION BRANCH NOT FOUND OR AMBIGUOUS', {
                nodeId: currentNode.id, evaluation, matchingEdges: matchingEdges.length, matchingTargets,
            });
            await endSession(session.id);
            return { type: 'text', text: 'We could not continue this conversation. Please try again later.' };
        }

        await chatSessionModel.update(session.id, {
            variables: mergedVariables,
            current_node_id: nextNode.id,
        });

        return await executeNode({
            bot,
            session: {
                ...session,
                current_node_id: nextNode.id,
                variables: mergedVariables
            },
            currentNode: nextNode
        });
    }

    /**
     *  
    */

    /**
     * NORMAL Message NODES
    */
    const response = await buildResponse(currentNode, session, bot);
    if (response?.stopChatbot) {
        console.log(
            "Session ended:",
            session.id
        );

        return response;
    }


    // ----------------------------------------
    // UPDATE CONTACT TAGS
    // ----------------------------------------

    if (key === "@whatsapp/update-tag") {
        try {
            const tags =
                data?.attributes?.tags || [];

            if (!Array.isArray(tags) || tags.length === 0) {
                console.log("No tags provided");
                return null;
            }

            console.log('Sessions variable',session)

            const phone = session?.phone_number;
            const userId = session?.variables?.user_id ?? bot?.user_id;

            if (!phone) {
                console.log(
                    "Phone number not found in session"
                );
                return null;
            }

            console.log("Updating tags:", {
                phone,
                tags,
            });

            // Get the contact
            if (!userId) {
                console.log("Bot owner user_id not found");
                return null;
            }

            const contact =
                await contactModel.findByPhone(
                    userId,
                    phone
                );

            if (!contact) {
                console.log(
                    "Contact not found for:",
                    phone
                );
                return null;
            }

            // Add tags to contact
            await contactTagRelationModel.bulkAddTags(
                contact.user_id,
                contact.id,
                tags
            );

            console.log(
                "Tags updated successfully"
            );

            // ----------------------------------------
            // Continue to next node
            // ----------------------------------------

            const edge = bot.edges.find(
                (e: any) =>
                    e.source === currentNode.id
            );

            if (!edge) {
                await endSession(session.id);

                return null;
            }

            const nextNode = bot.nodes.find(
                (n: any) =>
                    n.id === edge.target
            );

            if (!nextNode) {
                await endSession(session.id);

                return null;
            }

            await chatSessionModel.update(
                session.id,
                {
                    current_node_id: nextNode.id,
                }
            );

            return await executeNode({
                bot,
                session: {
                    ...session,
                    current_node_id: nextNode.id,
                },
                currentNode: nextNode,
            });

        } catch (error: any) {
            console.error(
                "UPDATE TAG NODE ERROR:",
                error
            );

            return null;
        }
    }

    // ---------------------------------------
    // Update Contact
    // --------------------------------------
    if (key === "@whatsapp/update-column") {
        try {
            const updates = data?.attributes?.columnUpdates || [];

            console.log("Update column", updates);

            if (!updates.length) {
                console.log("No column updates provided");
                return null;
            }

            const phone = session?.variables?.phone_number;

            if (!phone) {
                console.log("Phone number not found");
                return null;
            }

            const contact = await contactModel.findByUserPhoneNumber(phone);

            if (!contact) {
                console.log("Contact not found");
                return null;
            }

            const customFields = {
                ...(contact.custom_fields || {}),
            };

            for (const update of updates) {
                const column = update?.column;
                const value = update?.value;

                if (!column) {
                    console.log("Column missing");
                    continue;
                }

                customFields[column] = value;
            }

            await contactModel.update(contact.id, {
                custom_fields: customFields,
            });

            console.log("Contact custom fields updated", {
                contactId: contact.id,
                customFields,
            });

            const edge = bot.edges.find(
                (e: any) => e.source === currentNode.id
            );

            if (!edge) {
                await endSession(session.id);
                return null;
            }

            const nextNode = bot.nodes.find(
                (n: any) => n.id === edge.target
            );

            if (!nextNode) {
                await endSession(session.id);
                return null;
            }

            await chatSessionModel.update(session.id, {
                current_node_id: nextNode.id,
            });

            return await executeNode({
                bot,
                session: {
                    ...session,
                    current_node_id: nextNode.id,
                },
                currentNode: nextNode,
            });

        } catch (error) {
            console.error("UPDATE COLUMN ERROR:", error);
            return null;
        }
    }

    // Text nodes, such as the welcome message, do not wait for user input.
    // Follow their outgoing edge immediately and persist the next node.
    if (key !== "@whatsapp/send-text-message") return response;

    const edge = bot.edges.find(
        (e: any) => e.source === currentNode.id
    );

    if (!edge) {

        // await chatSessionModel.update(session.id, {
        //     active: false,
        //     current_node_id: null,
        //     completed_at: new Date()
        // });
        await endSession(session.id);

        return response;
    }

    const nextNode = bot.nodes.find((n: any) => n.id === edge.target);
    if (!nextNode) return response;

    await chatSessionModel.update(session.id, { current_node_id: nextNode.id });

    const nextResponse = await executeNode({
        bot,
        session: { ...session, current_node_id: nextNode.id },
        currentNode: nextNode,
    });

    const messages = (result: any) => result?.messages || (result ? [result] : []);
    return { messages: [...messages(response), ...messages(nextResponse)] };
}
