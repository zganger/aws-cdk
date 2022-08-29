"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = exports.forceSdkInstallation = exports.flatten = exports.PHYSICAL_RESOURCE_ID_REFERENCE = void 0;
/* eslint-disable no-console */
const child_process_1 = require("child_process");
const fs = require("fs");
const path_1 = require("path");
/**
 * Serialized form of the physical resource id for use in the operation parameters
 */
exports.PHYSICAL_RESOURCE_ID_REFERENCE = 'PHYSICAL:RESOURCEID:';
/**
 * Flattens a nested object
 *
 * @param object the object to be flattened
 * @returns a flat object with path as keys
 */
function flatten(object) {
    return Object.assign({}, ...function _flatten(child, path = []) {
        return [].concat(...Object.keys(child)
            .map(key => {
            const childKey = Buffer.isBuffer(child[key]) ? child[key].toString('utf8') : child[key];
            return typeof childKey === 'object' && childKey !== null
                ? _flatten(childKey, path.concat([key]))
                : ({ [path.concat([key]).join('.')]: childKey });
        }));
    }(object));
}
exports.flatten = flatten;
/**
 * Decodes encoded special values (physicalResourceId)
 */
function decodeSpecialValues(object, physicalResourceId) {
    return JSON.parse(JSON.stringify(object), (_k, v) => {
        switch (v) {
            case exports.PHYSICAL_RESOURCE_ID_REFERENCE:
                return physicalResourceId;
            default:
                return v;
        }
    });
}
/**
 * Filters the keys of an object.
 */
function filterKeys(object, pred) {
    return Object.entries(object)
        .reduce((acc, [k, v]) => pred(k)
        ? { ...acc, [k]: v }
        : acc, {});
}
let latestSdkInstalled = false;
function forceSdkInstallation() {
    latestSdkInstalled = false;
}
exports.forceSdkInstallation = forceSdkInstallation;
/**
 * Installs latest AWS SDK v2
 */
function installLatestSdk() {
    console.log('Installing latest AWS SDK v2');
    // Both HOME and --prefix are needed here because /tmp is the only writable location
    child_process_1.execSync('HOME=/tmp npm install aws-sdk@2 --production --no-package-lock --no-save --prefix /tmp');
    latestSdkInstalled = true;
}
// no currently patched services
const patchedServices = [];
/**
 * Patches the AWS SDK by loading service models in the same manner as the actual SDK
 */
function patchSdk(awsSdk) {
    const apiLoader = awsSdk.apiLoader;
    patchedServices.forEach(({ serviceName, apiVersions }) => {
        const lowerServiceName = serviceName.toLowerCase();
        if (!awsSdk.Service.hasService(lowerServiceName)) {
            apiLoader.services[lowerServiceName] = {};
            awsSdk[serviceName] = awsSdk.Service.defineService(lowerServiceName, apiVersions);
        }
        else {
            awsSdk.Service.addVersions(awsSdk[serviceName], apiVersions);
        }
        apiVersions.forEach(apiVersion => {
            Object.defineProperty(apiLoader.services[lowerServiceName], apiVersion, {
                get: function get() {
                    const modelFilePrefix = `aws-sdk-patch/${lowerServiceName}-${apiVersion}`;
                    const model = JSON.parse(fs.readFileSync(path_1.join(__dirname, `${modelFilePrefix}.service.json`), 'utf-8'));
                    model.paginators = JSON.parse(fs.readFileSync(path_1.join(__dirname, `${modelFilePrefix}.paginators.json`), 'utf-8')).pagination;
                    return model;
                },
                enumerable: true,
                configurable: true,
            });
        });
    });
    return awsSdk;
}
/* eslint-disable @typescript-eslint/no-require-imports, import/no-extraneous-dependencies */
async function handler(event, context) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _l, _m, _o, _p;
    try {
        let AWS;
        if (!latestSdkInstalled && event.ResourceProperties.InstallLatestAwsSdk === 'true') {
            try {
                installLatestSdk();
                AWS = require('/tmp/node_modules/aws-sdk');
            }
            catch (e) {
                console.log(`Failed to install latest AWS SDK v2: ${e}`);
                AWS = require('aws-sdk'); // Fallback to pre-installed version
            }
        }
        else if (latestSdkInstalled) {
            AWS = require('/tmp/node_modules/aws-sdk');
        }
        else {
            AWS = require('aws-sdk');
        }
        try {
            AWS = patchSdk(AWS);
        }
        catch (e) {
            console.log(`Failed to patch AWS SDK: ${e}. Proceeding with the installed copy.`);
        }
        console.log(JSON.stringify(event));
        console.log('AWS SDK VERSION: ' + AWS.VERSION);
        event.ResourceProperties.Create = decodeCall(event.ResourceProperties.Create);
        event.ResourceProperties.Update = decodeCall(event.ResourceProperties.Update);
        event.ResourceProperties.Delete = decodeCall(event.ResourceProperties.Delete);
        // Default physical resource id
        let physicalResourceId;
        switch (event.RequestType) {
            case 'Create':
                physicalResourceId = (_j = (_f = (_c = (_b = (_a = event.ResourceProperties.Create) === null || _a === void 0 ? void 0 : _a.physicalResourceId) === null || _b === void 0 ? void 0 : _b.id) !== null && _c !== void 0 ? _c : (_e = (_d = event.ResourceProperties.Update) === null || _d === void 0 ? void 0 : _d.physicalResourceId) === null || _e === void 0 ? void 0 : _e.id) !== null && _f !== void 0 ? _f : (_h = (_g = event.ResourceProperties.Delete) === null || _g === void 0 ? void 0 : _g.physicalResourceId) === null || _h === void 0 ? void 0 : _h.id) !== null && _j !== void 0 ? _j : event.LogicalResourceId;
                break;
            case 'Update':
            case 'Delete':
                physicalResourceId = (_o = (_m = (_l = event.ResourceProperties[event.RequestType]) === null || _l === void 0 ? void 0 : _l.physicalResourceId) === null || _m === void 0 ? void 0 : _m.id) !== null && _o !== void 0 ? _o : event.PhysicalResourceId;
                break;
        }
        let flatData = {};
        let data = {};
        const call = event.ResourceProperties[event.RequestType];
        if (call) {
            let credentials;
            if (call.assumedRoleArn) {
                const timestamp = (new Date()).getTime();
                const params = {
                    RoleArn: call.assumedRoleArn,
                    RoleSessionName: `${timestamp}-${physicalResourceId}`.substring(0, 64),
                };
                credentials = new AWS.ChainableTemporaryCredentials({
                    params: params,
                });
            }
            if (!Object.prototype.hasOwnProperty.call(AWS, call.service)) {
                throw Error(`Service ${call.service} does not exist in AWS SDK version ${AWS.VERSION}.`);
            }
            const awsService = new AWS[call.service]({
                apiVersion: call.apiVersion,
                credentials: credentials,
                region: call.region,
            });
            try {
                const response = await awsService[call.action](call.parameters && decodeSpecialValues(call.parameters, physicalResourceId)).promise();
                flatData = {
                    apiVersion: awsService.config.apiVersion,
                    region: awsService.config.region,
                    ...flatten(response),
                };
                let outputPaths;
                if (call.outputPath) {
                    outputPaths = [call.outputPath];
                }
                else if (call.outputPaths) {
                    outputPaths = call.outputPaths;
                }
                if (outputPaths) {
                    data = filterKeys(flatData, startsWithOneOf(outputPaths));
                }
                else {
                    data = flatData;
                }
            }
            catch (e) {
                if (!call.ignoreErrorCodesMatching || !new RegExp(call.ignoreErrorCodesMatching).test(e.code)) {
                    throw e;
                }
            }
            if ((_p = call.physicalResourceId) === null || _p === void 0 ? void 0 : _p.responsePath) {
                physicalResourceId = flatData[call.physicalResourceId.responsePath];
            }
        }
        await respond('SUCCESS', 'OK', physicalResourceId, data);
    }
    catch (e) {
        console.log(e);
        await respond('FAILED', e.message || 'Internal Error', context.logStreamName, {});
    }
    function respond(responseStatus, reason, physicalResourceId, data) {
        const responseBody = JSON.stringify({
            Status: responseStatus,
            Reason: reason,
            PhysicalResourceId: physicalResourceId,
            StackId: event.StackId,
            RequestId: event.RequestId,
            LogicalResourceId: event.LogicalResourceId,
            NoEcho: false,
            Data: data,
        });
        console.log('Responding', responseBody);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const parsedUrl = require('url').parse(event.ResponseURL);
        const requestOptions = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.path,
            method: 'PUT',
            headers: { 'content-type': '', 'content-length': responseBody.length },
        };
        return new Promise((resolve, reject) => {
            try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const request = require('https').request(requestOptions, resolve);
                request.on('error', reject);
                request.write(responseBody);
                request.end();
            }
            catch (e) {
                reject(e);
            }
        });
    }
}
exports.handler = handler;
function decodeCall(call) {
    if (!call) {
        return undefined;
    }
    return JSON.parse(call);
}
function startsWithOneOf(searchStrings) {
    return function (string) {
        for (const searchString of searchStrings) {
            if (string.startsWith(searchString)) {
                return true;
            }
        }
        return false;
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSwrQkFBK0I7QUFDL0IsaURBQXlDO0FBQ3pDLHlCQUF5QjtBQUN6QiwrQkFBNEI7QUFTNUI7O0dBRUc7QUFDVSxRQUFBLDhCQUE4QixHQUFHLHNCQUFzQixDQUFDO0FBRXJFOzs7OztHQUtHO0FBQ0gsU0FBZ0IsT0FBTyxDQUFDLE1BQWM7SUFDcEMsT0FBTyxNQUFNLENBQUMsTUFBTSxDQUNsQixFQUFFLEVBQ0YsR0FBRyxTQUFTLFFBQVEsQ0FBQyxLQUFVLEVBQUUsT0FBaUIsRUFBRTtRQUNsRCxPQUFPLEVBQUUsQ0FBQyxNQUFNLENBQUMsR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQzthQUNuQyxHQUFHLENBQUMsR0FBRyxDQUFDLEVBQUU7WUFDVCxNQUFNLFFBQVEsR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDeEYsT0FBTyxPQUFPLFFBQVEsS0FBSyxRQUFRLElBQUksUUFBUSxLQUFLLElBQUk7Z0JBQ3RELENBQUMsQ0FBQyxRQUFRLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO2dCQUN4QyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsUUFBUSxFQUFFLENBQUMsQ0FBQztRQUNyRCxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ1IsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUNWLENBQUM7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Q0FBQztnQkFDbEUsT0FBTyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsTUFBTSxDQUFDLENBQUM7Z0JBQzVCLE9BQU8sQ0FBQyxLQUFLLENBQUMsWUFBWSxDQUFDLENBQUM7Z0JBQzVCLE9BQU8sQ0FBQyxHQUFHLEVBQUUsQ0FBQzthQUNmO1lBQUMsT0FBTyxDQUFDLEVBQUU7Z0JBQ1YsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDO2FBQ1g7UUFDSCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUM7QUFDSCxDQUFDO0FBakpELDBCQWlKQztBQUVELFNBQVMsVUFBVSxDQUFDLElBQXdCO0lBQzFDLElBQUksQ0FBQyxJQUFJLEVBQUU7UUFBRSxPQUFPLFNBQVMsQ0FBQztLQUFFO0lBQ2hDLE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztBQUMxQixDQUFDO0FBRUQsU0FBUyxlQUFlLENBQUMsYUFBdUI7SUFDOUMsT0FBTyxVQUFTLE1BQWM7UUFDNUIsS0FBSyxNQUFNLFlBQVksSUFBSSxhQUFhLEVBQUU7WUFDeEMsSUFBSSxNQUFNLENBQUMsVUFBVSxDQUFDLFlBQVksQ0FBQyxFQUFFO2dCQUNuQyxPQUFPLElBQUksQ0FBQzthQUNiO1NBQ0Y7UUFDRCxPQUFPLEtBQUssQ0FBQztJQUNmLENBQUMsQ0FBQztBQUNKLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKiBlc2xpbnQtZGlzYWJsZSBuby1jb25zb2xlICovXG5pbXBvcnQgeyBleGVjU3luYyB9IGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xuaW1wb3J0IHsgam9pbiB9IGZyb20gJ3BhdGgnO1xuLy8gaW1wb3J0IHRoZSBBV1NMYW1iZGEgcGFja2FnZSBleHBsaWNpdGx5LFxuLy8gd2hpY2ggaXMgZ2xvYmFsbHkgYXZhaWxhYmxlIGluIHRoZSBMYW1iZGEgcnVudGltZSxcbi8vIGFzIG90aGVyd2lzZSBsaW5raW5nIHRoaXMgcmVwb3NpdG9yeSB3aXRoIGxpbmstYWxsLnNoXG4vLyBmYWlscyBpbiB0aGUgQ0RLIGFwcCBleGVjdXRlZCB3aXRoIHRzLW5vZGVcbi8qIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBpbXBvcnQvbm8tZXh0cmFuZW91cy1kZXBlbmRlbmNpZXMsaW1wb3J0L25vLXVucmVzb2x2ZWQgKi9cbmltcG9ydCAqIGFzIEFXU0xhbWJkYSBmcm9tICdhd3MtbGFtYmRhJztcbmltcG9ydCB7IEF3c1Nka0NhbGwgfSBmcm9tICcuLi9hd3MtY3VzdG9tLXJlc291cmNlJztcblxuLyoqXG4gKiBTZXJpYWxpemVkIGZvcm0gb2YgdGhlIHBoeXNpY2FsIHJlc291cmNlIGlkIGZvciB1c2UgaW4gdGhlIG9wZXJhdGlvbiBwYXJhbWV0ZXJzXG4gKi9cbmV4cG9ydCBjb25zdCBQSFlTSUNBTF9SRVNPVVJDRV9JRF9SRUZFUkVOQ0UgPSAnUEhZU0lDQUw6UkVTT1VSQ0VJRDonO1xuXG4vKipcbiAqIEZsYXR0ZW5zIGEgbmVzdGVkIG9iamVjdFxuICpcbiAqIEBwYXJhbSBvYmplY3QgdGhlIG9iamVjdCB0byBiZSBmbGF0dGVuZWRcbiAqIEByZXR1cm5zIGEgZmxhdCBvYmplY3Qgd2l0aCBwYXRoIGFzIGtleXNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZsYXR0ZW4ob2JqZWN0OiBvYmplY3QpOiB7IFtrZXk6IHN0cmluZ106IGFueSB9IHtcbiAgcmV0dXJuIE9iamVjdC5hc3NpZ24oXG4gICAge30sXG4gICAgLi4uZnVuY3Rpb24gX2ZsYXR0ZW4oY2hpbGQ6IGFueSwgcGF0aDogc3RyaW5nW10gPSBbXSk6IGFueSB7XG4gICAgICByZXR1cm4gW10uY29uY2F0KC4uLk9iamVjdC5rZXlzKGNoaWxkKVxuICAgICAgICAubWFwKGtleSA9PiB7XG4gICAgICAgICAgY29uc3QgY2hpbGRLZXkgPSBCdWZmZXIuaXNCdWZmZXIoY2hpbGRba2V5XSkgPyBjaGlsZFtrZXldLnRvU3RyaW5nKCd1dGY4JykgOiBjaGlsZFtrZXldO1xuICAgICAgICAgIHJldHVybiB0eXBlb2YgY2hpbGRLZXkgPT09ICdvYmplY3QnICYmIGNoaWxkS2V5ICE9PSBudWxsXG4gICAgICAgICAgICA/IF9mbGF0dGVuKGNoaWxkS2V5LCBwYXRoLmNvbmNhdChba2V5XSkpXG4gICAgICAgICAgICA6ICh7IFtwYXRoLmNvbmNhdChba2V5XSkuam9pbignLicpXTogY2hpbGRLZXkgfSk7XG4gICAgICAgIH0pKTtcbiAgICB9KG9iamVjdCksXG4gICk7XG59XG5cbi8qKlxuICogRGVjb2RlcyBlbmNvZGVkIHNwZWNpYWwgdmFsdWVzIChwaHlzaWNhbFJlc291cmNlSWQpXG4gKi9cbmZ1bmN0aW9uIGRlY29kZVNwZWNpYWxWYWx1ZXMob2JqZWN0OiBvYmplY3QsIHBoeXNpY2FsUmVzb3VyY2VJZDogc3RyaW5nKSB7XG4gIHJldHVybiBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KG9iamVjdCksIChfaywgdikgPT4ge1xuICAgIHN3aXRjaCAodikge1xuICAgICAgY2FzZSBQSFlTSUNBTF9SRVNPVVJDRV9JRF9SRUZFUkVOQ0U6XG4gICAgICAgIHJldHVybiBwaHlzaWNhbFJlc291cmNlSWQ7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICByZXR1cm4gdjtcbiAgICB9XG4gIH0pO1xufVxuXG4vKipcbiAqIEZpbHRlcnMgdGhlIGtleXMgb2YgYW4gb2JqZWN0LlxuICovXG5mdW5jdGlvbiBmaWx0ZXJLZXlzKG9iamVjdDogb2JqZWN0LCBwcmVkOiAoa2V5OiBzdHJpbmcpID0+IGJvb2xlYW4pIHtcbiAgcmV0dXJuIE9iamVjdC5lbnRyaWVzKG9iamVjdClcbiAgICAucmVkdWNlKFxuICAgICAgKGFjYywgW2ssIHZdKSA9PiBwcmVkKGspXG4gICAgICAgID8geyAuLi5hY2MsIFtrXTogdiB9XG4gICAgICAgIDogYWNjLFxuICAgICAge30sXG4gICAgKTtcbn1cblxubGV0IGxhdGVzdFNka0luc3RhbGxlZCA9IGZhbHNlO1xuXG5leHBvcnQgZnVuY3Rpb24gZm9yY2VTZGtJbnN0YWxsYXRpb24oKSB7XG4gIGxhdGVzdFNka0luc3RhbGxlZCA9IGZhbHNlO1xufVxuXG4vKipcbiAqIEluc3RhbGxzIGxhdGVzdCBBV1MgU0RLIHYyXG4gKi9cbmZ1bmN0aW9uIGluc3RhbGxMYXRlc3RTZGsoKTogdm9pZCB7XG4gIGNvbnNvbGUubG9nKCdJbnN0YWxsaW5nIGxhdGVzdCBBV1MgU0RLIHYyJyk7XG4gIC8vIEJvdGggSE9NRSBhbmQgLS1wcmVmaXggYXJlIG5lZWRlZCBoZXJlIGJlY2F1c2UgL3RtcCBpcyB0aGUgb25seSB3cml0YWJsZSBsb2NhdGlvblxuICBleGVjU3luYygnSE9NRT0vdG1wIG5wbSBpbnN0YWxsIGF3cy1zZGtAMiAtLXByb2R1Y3Rpb24gLS1uby1wYWNrYWdlLWxvY2sgLS1uby1zYXZlIC0tcHJlZml4IC90bXAnKTtcbiAgbGF0ZXN0U2RrSW5zdGFsbGVkID0gdHJ1ZTtcbn1cblxuLy8gbm8gY3VycmVudGx5IHBhdGNoZWQgc2VydmljZXNcbmNvbnN0IHBhdGNoZWRTZXJ2aWNlczogeyBzZXJ2aWNlTmFtZTogc3RyaW5nOyBhcGlWZXJzaW9uczogc3RyaW5nW10gfVtdID0gW107XG4vKipcbiAqIFBhdGNoZXMgdGhlIEFXUyBTREsgYnkgbG9hZGluZyBzZXJ2aWNlIG1vZGVscyBpbiB0aGUgc2FtZSBtYW5uZXIgYXMgdGhlIGFjdHVhbCBTREtcbiAqL1xuZnVuY3Rpb24gcGF0Y2hTZGsoYXdzU2RrOiBhbnkpOiBhbnkge1xuICBjb25zdCBhcGlMb2FkZXIgPSBhd3NTZGsuYXBpTG9hZGVyO1xuICBwYXRjaGVkU2VydmljZXMuZm9yRWFjaCgoeyBzZXJ2aWNlTmFtZSwgYXBpVmVyc2lvbnMgfSkgPT4ge1xuICAgIGNvbnN0IGxvd2VyU2VydmljZU5hbWUgPSBzZXJ2aWNlTmFtZS50b0xvd2VyQ2FzZSgpO1xuICAgIGlmICghYXdzU2RrLlNlcnZpY2UuaGFzU2VydmljZShsb3dlclNlcnZpY2VOYW1lKSkge1xuICAgICAgYXBpTG9hZGVyLnNlcnZpY2VzW2xvd2VyU2VydmljZU5hbWVdID0ge307XG4gICAgICBhd3NTZGtbc2VydmljZU5hbWVdID0gYXdzU2RrLlNlcnZpY2UuZGVmaW5lU2VydmljZShsb3dlclNlcnZpY2VOYW1lLCBhcGlWZXJzaW9ucyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGF3c1Nkay5TZXJ2aWNlLmFkZFZlcnNpb25zKGF3c1Nka1tzZXJ2aWNlTmFtZV0sIGFwaVZlcnNpb25zKTtcbiAgICB9XG4gICAgYXBpVmVyc2lvbnMuZm9yRWFjaChhcGlWZXJzaW9uID0+IHtcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShhcGlMb2FkZXIuc2VydmljZXNbbG93ZXJTZXJ2aWNlTmFtZV0sIGFwaVZlcnNpb24sIHtcbiAgICAgICAgZ2V0OiBmdW5jdGlvbiBnZXQoKSB7XG4gICAgICAgICAgY29uc3QgbW9kZWxGaWxlUHJlZml4ID0gYGF3cy1zZGstcGF0Y2gvJHtsb3dlclNlcnZpY2VOYW1lfS0ke2FwaVZlcnNpb259YDtcbiAgICAgICAgICBjb25zdCBtb2RlbCA9IEpTT04ucGFyc2UoZnMucmVhZEZpbGVTeW5jKGpvaW4oX19kaXJuYW1lLCBgJHttb2RlbEZpbGVQcmVmaXh9LnNlcnZpY2UuanNvbmApLCAndXRmLTgnKSk7XG4gICAgICAgICAgbW9kZWwucGFnaW5hdG9ycyA9IEpTT04ucGFyc2UoZnMucmVhZEZpbGVTeW5jKGpvaW4oX19kaXJuYW1lLCBgJHttb2RlbEZpbGVQcmVmaXh9LnBhZ2luYXRvcnMuanNvbmApLCAndXRmLTgnKSkucGFnaW5hdGlvbjtcbiAgICAgICAgICByZXR1cm4gbW9kZWw7XG4gICAgICAgIH0sXG4gICAgICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZSxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9KTtcbiAgcmV0dXJuIGF3c1Nkaztcbn1cblxuLyogZXNsaW50LWRpc2FibGUgQHR5cGVzY3JpcHQtZXNsaW50L25vLXJlcXVpcmUtaW1wb3J0cywgaW1wb3J0L25vLWV4dHJhbmVvdXMtZGVwZW5kZW5jaWVzICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaGFuZGxlcihldmVudDogQVdTTGFtYmRhLkNsb3VkRm9ybWF0aW9uQ3VzdG9tUmVzb3VyY2VFdmVudCwgY29udGV4dDogQVdTTGFtYmRhLkNvbnRleHQpIHtcbiAgdHJ5IHtcbiAgICBsZXQgQVdTOiBhbnk7XG4gICAgaWYgKCFsYXRlc3RTZGtJbnN0YWxsZWQgJiYgZXZlbnQuUmVzb3VyY2VQcm9wZXJ0aWVzLkluc3RhbGxMYXRlc3RBd3NTZGsgPT09ICd0cnVlJykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgaW5zdGFsbExhdGVzdFNkaygpO1xuICAgICAgICBBV1MgPSByZXF1aXJlKCcvdG1wL25vZGVfbW9kdWxlcy9hd3Mtc2RrJyk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBGYWlsZWQgdG8gaW5zdGFsbCBsYXRlc3QgQVdTIFNESyB2MjogJHtlfWApO1xuICAgICAgICBBV1MgPSByZXF1aXJlKCdhd3Mtc2RrJyk7IC8vIEZhbGxiYWNrIHRvIHByZS1pbnN0YWxsZWQgdmVyc2lvblxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAobGF0ZXN0U2RrSW5zdGFsbGVkKSB7XG4gICAgICBBV1MgPSByZXF1aXJlKCcvdG1wL25vZGVfbW9kdWxlcy9hd3Mtc2RrJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIEFXUyA9IHJlcXVpcmUoJ2F3cy1zZGsnKTtcbiAgICB9XG4gICAgdHJ5IHtcbiAgICAgIEFXUyA9IHBhdGNoU2RrKEFXUyk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc29sZS5sb2coYEZhaWxlZCB0byBwYXRjaCBBV1MgU0RLOiAke2V9LiBQcm9jZWVkaW5nIHdpdGggdGhlIGluc3RhbGxlZCBjb3B5LmApO1xuICAgIH1cblxuICAgIGNvbnNvbGUubG9nKEpTT04uc3RyaW5naWZ5KGV2ZW50KSk7XG4gICAgY29uc29sZS5sb2coJ0FXUyBTREsgVkVSU0lPTjogJyArIEFXUy5WRVJTSU9OKTtcblxuICAgIGV2ZW50LlJlc291cmNlUHJvcGVydGllcy5DcmVhdGUgPSBkZWNvZGVDYWxsKGV2ZW50LlJlc291cmNlUHJvcGVydGllcy5DcmVhdGUpO1xuICAgIGV2ZW50LlJlc291cmNlUHJvcGVydGllcy5VcGRhdGUgPSBkZWNvZGVDYWxsKGV2ZW50LlJlc291cmNlUHJvcGVydGllcy5VcGRhdGUpO1xuICAgIGV2ZW50LlJlc291cmNlUHJvcGVydGllcy5EZWxldGUgPSBkZWNvZGVDYWxsKGV2ZW50LlJlc291cmNlUHJvcGVydGllcy5EZWxldGUpO1xuICAgIC8vIERlZmF1bHQgcGh5c2ljYWwgcmVzb3VyY2UgaWRcbiAgICBsZXQgcGh5c2ljYWxSZXNvdXJjZUlkOiBzdHJpbmc7XG4gICAgc3dpdGNoIChldmVudC5SZXF1ZXN0VHlwZSkge1xuICAgICAgY2FzZSAnQ3JlYXRlJzpcbiAgICAgICAgcGh5c2ljYWxSZXNvdXJjZUlkID0gZXZlbnQuUmVzb3VyY2VQcm9wZXJ0aWVzLkNyZWF0ZT8ucGh5c2ljYWxSZXNvdXJjZUlkPy5pZCA/P1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICBldmVudC5SZXNvdXJjZVByb3BlcnRpZXMuVXBkYXRlPy5waHlzaWNhbFJlc291cmNlSWQ/LmlkID8/XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIGV2ZW50LlJlc291cmNlUHJvcGVydGllcy5EZWxldGU/LnBoeXNpY2FsUmVzb3VyY2VJZD8uaWQgPz9cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZXZlbnQuTG9naWNhbFJlc291cmNlSWQ7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnVXBkYXRlJzpcbiAgICAgIGNhc2UgJ0RlbGV0ZSc6XG4gICAgICAgIHBoeXNpY2FsUmVzb3VyY2VJZCA9IGV2ZW50LlJlc291cmNlUHJvcGVydGllc1tldmVudC5SZXF1ZXN0VHlwZV0/LnBoeXNpY2FsUmVzb3VyY2VJZD8uaWQgPz8gZXZlbnQuUGh5c2ljYWxSZXNvdXJjZUlkO1xuICAgICAgICBicmVhaztcbiAgICB9XG5cbiAgICBsZXQgZmxhdERhdGE6IHsgW2tleTogc3RyaW5nXTogc3RyaW5nIH0gPSB7fTtcbiAgICBsZXQgZGF0YTogeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfSA9IHt9O1xuICAgIGNvbnN0IGNhbGw6IEF3c1Nka0NhbGwgfCB1bmRlZmluZWQgPSBldmVudC5SZXNvdXJjZVByb3BlcnRpZXNbZXZlbnQuUmVxdWVzdFR5cGVdO1xuXG4gICAgaWYgKGNhbGwpIHtcblxuICAgICAgbGV0IGNyZWRlbnRpYWxzO1xuICAgICAgaWYgKGNhbGwuYXNzdW1lZFJvbGVBcm4pIHtcbiAgICAgICAgY29uc3QgdGltZXN0YW1wID0gKG5ldyBEYXRlKCkpLmdldFRpbWUoKTtcblxuICAgICAgICBjb25zdCBwYXJhbXMgPSB7XG4gICAgICAgICAgUm9sZUFybjogY2FsbC5hc3N1bWVkUm9sZUFybixcbiAgICAgICAgICBSb2xlU2Vzc2lvbk5hbWU6IGAke3RpbWVzdGFtcH0tJHtwaHlzaWNhbFJlc291cmNlSWR9YC5zdWJzdHJpbmcoMCwgNjQpLFxuICAgICAgICB9O1xuXG4gICAgICAgIGNyZWRlbnRpYWxzID0gbmV3IEFXUy5DaGFpbmFibGVUZW1wb3JhcnlDcmVkZW50aWFscyh7XG4gICAgICAgICAgcGFyYW1zOiBwYXJhbXMsXG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICBpZiAoIU9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChBV1MsIGNhbGwuc2VydmljZSkpIHtcbiAgICAgICAgdGhyb3cgRXJyb3IoYFNlcnZpY2UgJHtjYWxsLnNlcnZpY2V9IGRvZXMgbm90IGV4aXN0IGluIEFXUyBTREsgdmVyc2lvbiAke0FXUy5WRVJTSU9OfS5gKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGF3c1NlcnZpY2UgPSBuZXcgKEFXUyBhcyBhbnkpW2NhbGwuc2VydmljZV0oe1xuICAgICAgICBhcGlWZXJzaW9uOiBjYWxsLmFwaVZlcnNpb24sXG4gICAgICAgIGNyZWRlbnRpYWxzOiBjcmVkZW50aWFscyxcbiAgICAgICAgcmVnaW9uOiBjYWxsLnJlZ2lvbixcbiAgICAgIH0pO1xuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGF3c1NlcnZpY2VbY2FsbC5hY3Rpb25dKFxuICAgICAgICAgIGNhbGwucGFyYW1ldGVycyAmJiBkZWNvZGVTcGVjaWFsVmFsdWVzKGNhbGwucGFyYW1ldGVycywgcGh5c2ljYWxSZXNvdXJjZUlkKSkucHJvbWlzZSgpO1xuICAgICAgICBmbGF0RGF0YSA9IHtcbiAgICAgICAgICBhcGlWZXJzaW9uOiBhd3NTZXJ2aWNlLmNvbmZpZy5hcGlWZXJzaW9uLCAvLyBGb3IgdGVzdCBwdXJwb3NlczogY2hlY2sgaWYgYXBpVmVyc2lvbiB3YXMgY29ycmVjdGx5IHBhc3NlZC5cbiAgICAgICAgICByZWdpb246IGF3c1NlcnZpY2UuY29uZmlnLnJlZ2lvbiwgLy8gRm9yIHRlc3QgcHVycG9zZXM6IGNoZWNrIGlmIHJlZ2lvbiB3YXMgY29ycmVjdGx5IHBhc3NlZC5cbiAgICAgICAgICAuLi5mbGF0dGVuKHJlc3BvbnNlKSxcbiAgICAgICAgfTtcblxuICAgICAgICBsZXQgb3V0cHV0UGF0aHM6IHN0cmluZ1tdIHwgdW5kZWZpbmVkO1xuICAgICAgICBpZiAoY2FsbC5vdXRwdXRQYXRoKSB7XG4gICAgICAgICAgb3V0cHV0UGF0aHMgPSBbY2FsbC5vdXRwdXRQYXRoXTtcbiAgICAgICAgfSBlbHNlIGlmIChjYWxsLm91dHB1dFBhdGhzKSB7XG4gICAgICAgICAgb3V0cHV0UGF0aHMgPSBjYWxsLm91dHB1dFBhdGhzO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG91dHB1dFBhdGhzKSB7XG4gICAgICAgICAgZGF0YSA9IGZpbHRlcktleXMoZmxhdERhdGEsIHN0YXJ0c1dpdGhPbmVPZihvdXRwdXRQYXRocykpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGRhdGEgPSBmbGF0RGF0YTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBpZiAoIWNhbGwuaWdub3JlRXJyb3JDb2Rlc01hdGNoaW5nIHx8ICFuZXcgUmVnRXhwKGNhbGwuaWdub3JlRXJyb3JDb2Rlc01hdGNoaW5nKS50ZXN0KGUuY29kZSkpIHtcbiAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChjYWxsLnBoeXNpY2FsUmVzb3VyY2VJZD8ucmVzcG9uc2VQYXRoKSB7XG4gICAgICAgIHBoeXNpY2FsUmVzb3VyY2VJZCA9IGZsYXREYXRhW2NhbGwucGh5c2ljYWxSZXNvdXJjZUlkLnJlc3BvbnNlUGF0aF07XG4gICAgICB9XG4gICAgfVxuXG4gICAgYXdhaXQgcmVzcG9uZCgnU1VDQ0VTUycsICdPSycsIHBoeXNpY2FsUmVzb3VyY2VJZCwgZGF0YSk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmxvZyhlKTtcbiAgICBhd2FpdCByZXNwb25kKCdGQUlMRUQnLCBlLm1lc3NhZ2UgfHwgJ0ludGVybmFsIEVycm9yJywgY29udGV4dC5sb2dTdHJlYW1OYW1lLCB7fSk7XG4gIH1cblxuICBmdW5jdGlvbiByZXNwb25kKHJlc3BvbnNlU3RhdHVzOiBzdHJpbmcsIHJlYXNvbjogc3RyaW5nLCBwaHlzaWNhbFJlc291cmNlSWQ6IHN0cmluZywgZGF0YTogYW55KSB7XG4gICAgY29uc3QgcmVzcG9uc2VCb2R5ID0gSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgU3RhdHVzOiByZXNwb25zZVN0YXR1cyxcbiAgICAgIFJlYXNvbjogcmVhc29uLFxuICAgICAgUGh5c2ljYWxSZXNvdXJjZUlkOiBwaHlzaWNhbFJlc291cmNlSWQsXG4gICAgICBTdGFja0lkOiBldmVudC5TdGFja0lkLFxuICAgICAgUmVxdWVzdElkOiBldmVudC5SZXF1ZXN0SWQsXG4gICAgICBMb2dpY2FsUmVzb3VyY2VJZDogZXZlbnQuTG9naWNhbFJlc291cmNlSWQsXG4gICAgICBOb0VjaG86IGZhbHNlLFxuICAgICAgRGF0YTogZGF0YSxcbiAgICB9KTtcblxuICAgIGNvbnNvbGUubG9nKCdSZXNwb25kaW5nJywgcmVzcG9uc2VCb2R5KTtcblxuICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tcmVxdWlyZS1pbXBvcnRzXG4gICAgY29uc3QgcGFyc2VkVXJsID0gcmVxdWlyZSgndXJsJykucGFyc2UoZXZlbnQuUmVzcG9uc2VVUkwpO1xuICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zID0ge1xuICAgICAgaG9zdG5hbWU6IHBhcnNlZFVybC5ob3N0bmFtZSxcbiAgICAgIHBhdGg6IHBhcnNlZFVybC5wYXRoLFxuICAgICAgbWV0aG9kOiAnUFVUJyxcbiAgICAgIGhlYWRlcnM6IHsgJ2NvbnRlbnQtdHlwZSc6ICcnLCAnY29udGVudC1sZW5ndGgnOiByZXNwb25zZUJvZHkubGVuZ3RoIH0sXG4gICAgfTtcblxuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLXJlcXVpcmUtaW1wb3J0c1xuICAgICAgICBjb25zdCByZXF1ZXN0ID0gcmVxdWlyZSgnaHR0cHMnKS5yZXF1ZXN0KHJlcXVlc3RPcHRpb25zLCByZXNvbHZlKTtcbiAgICAgICAgcmVxdWVzdC5vbignZXJyb3InLCByZWplY3QpO1xuICAgICAgICByZXF1ZXN0LndyaXRlKHJlc3BvbnNlQm9keSk7XG4gICAgICAgIHJlcXVlc3QuZW5kKCk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIHJlamVjdChlKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxufVxuXG5mdW5jdGlvbiBkZWNvZGVDYWxsKGNhbGw6IHN0cmluZyB8IHVuZGVmaW5lZCkge1xuICBpZiAoIWNhbGwpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICByZXR1cm4gSlNPTi5wYXJzZShjYWxsKTtcbn1cblxuZnVuY3Rpb24gc3RhcnRzV2l0aE9uZU9mKHNlYXJjaFN0cmluZ3M6IHN0cmluZ1tdKTogKHN0cmluZzogc3RyaW5nKSA9PiBib29sZWFuIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKHN0cmluZzogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgZm9yIChjb25zdCBzZWFyY2hTdHJpbmcgb2Ygc2VhcmNoU3RyaW5ncykge1xuICAgICAgaWYgKHN0cmluZy5zdGFydHNXaXRoKHNlYXJjaFN0cmluZykpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfTtcbn1cbiJdfQ==