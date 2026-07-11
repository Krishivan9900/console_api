import axios from 'axios';
import chatSessionModel from "@surefy/console/app/models/chatSession.model";
import { buildResponse } from "@surefy/console/utils";
import { replaceVariables } from '@surefy/console/utils';

export const executeNode = async ({
  bot,
  session,
  currentNode
}: any):Promise<any> => {
    if(!currentNode) return null;

    const data = currentNode.data
    const key = data?.key

    console.log("EXECUTING NODE:",key,data,session)

    /**
     * HTTP Node
     */
    if (key === "@http/http-request") {
        try {
            let requestBody = data?.attributes?.body;

            if (typeof requestBody === "string") {
                requestBody = JSON.parse(requestBody);
            }
            requestBody = replaceVariables(
                requestBody,
                session.variables || {}
            );

            console.log("Parsed Body", requestBody)

            const response = await axios({
                method: data?.attributes?.method || "GET",
                url: data?.attributes?.url,
                data: requestBody
            })

            const responseData = response.data;
            console.log("HTTP Response", responseData);

            //STORE Variables
            const updatedVariables = {
                ...(session.variables),
                http_response: responseData
            }

            // await chatSessionModel.update(session.id,{
            //     variables: updatedVariables
            // })

            //FIND Next Node
            const edge = bot.edges.find(
                (e: any) => e.source === currentNode.id
            );

            if (!edge) return null;

            const nextNode = bot.nodes.find(
                (n: any) => n.id === edge.target
            );

            if (!nextNode) return null;

            await chatSessionModel.update(session.id, {
                current_node_id: nextNode.id
            });

            return await executeNode({
                bot,
                session: {
                    ...session,
                    variables: updatedVariables,
                    current_node_id: nextNode.id
                },
                currentNode: nextNode
            })

        } catch (error: any) {
            console.log("HTTP Error:", error?.response?.data)

            return {
                type: "text",
                text: "Something went wrong"
            }
        }
    }

    /**
     * CONDITION Node
     */
    if(key === "@condition/condition-action"){
        // const conditions = data.attributes.conditions || [];
        let updateVariable:any={};
        const conditionVariable = data?.attributes?.variable || "";

        const variables = session.variables || {};
        console.log("Condition variabes",variables)

        console.log("condition Variable",conditionVariable)
        
        if(conditionVariable ){
            const value = variables?.http_response?.data[
                conditionVariable
            ]

            console.log("Value",value)

            if(value !== undefined){
                updateVariable[conditionVariable] = value;
            }
        }

        const mergedVariables = {
            ...variables,
            ...updateVariable
        }
        console.log("Merged Variable",mergedVariables)

        const success = variables?.http_response?.success === true
        console.log("HTTP Success",success)

    
        // let evaluation = true;

        // for(const condition of conditions){
        //     const variablePath = condition.field
        //          .replace("{{","")
        //          .replace("}}","");

        //     const actualValue = variablePath
        //         .split(".")
        //         .reduce(
        //          (obj:any,key:string)=> obj?.[key],
        //          variables
        //         );

        //     console.log("Actual Value",actualValue)
        //     console.log("Condition",condition)
           
        //     const expectedValue = condition.value;
        //     if(condition.comparator === 'equals'){
        //         evaluation = 
        //           String(actualValue).toLowerCase() === 
        //           String(expectedValue).toLowerCase();
        //     }

        //     console.log("Expected Value",expectedValue)
        // }
        // console.log("CONDITION Result:", evaluation)

        // const handle = evaluation 
        //  ? `condition-true-${currentNode.id}`
        //  : `condition-false-${currentNode.id}`

        // console.log("Handle", handle)

        const edge = bot.edges.find(
            (e:any)=>
               e.source === currentNode.id && 
               String(e.data.condition) === String(success)
        )

        console.log("Edge",edge)

        if(!edge) return null;

        const nextNode = bot.nodes.find(
            (n:any)=> n.id === edge.target
        );

        console.log("NextNode",nextNode)

        if(!nextNode) return null;

        await chatSessionModel.update(session.id,{
            variables:mergedVariables,
            current_node_id : nextNode.id,
        });

        return await executeNode({
            bot,
            session:{
                ...session,
                current_node_id: nextNode.id
            },
            currentNode:nextNode
        });
    }

    /**
     *  
    */

    /**
     * NORMAL Message NODES
    */
    return buildResponse(currentNode,session)
}