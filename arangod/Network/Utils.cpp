////////////////////////////////////////////////////////////////////////////////
/// DISCLAIMER
///
/// Copyright 2018 ArangoDB GmbH, Cologne, Germany
///
/// Licensed under the Apache License, Version 2.0 (the "License");
/// you may not use this file except in compliance with the License.
/// You may obtain a copy of the License at
///
///     http://www.apache.org/licenses/LICENSE-2.0
///
/// Unless required by applicable law or agreed to in writing, software
/// distributed under the License is distributed on an "AS IS" BASIS,
/// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
/// See the License for the specific language governing permissions and
/// limitations under the License.
///
/// Copyright holder is ArangoDB GmbH, Cologne, Germany
///
/// @author Simon Grätzer
////////////////////////////////////////////////////////////////////////////////

#include "Utils.h"

#include "Agency/AgencyFeature.h"
#include "Agency/Agent.h"
#include "Basics/Common.h"
#include "Basics/NumberUtils.h"
#include "Cluster/ClusterInfo.h"
#include "Logger/Logger.h"
#include "Network/Methods.h"
#include "VocBase/ticks.h"

#include <velocypack/velocypack-aliases.h>

namespace arangodb {
namespace network {
  
Result resolveDestination(DestinationId const& dest,
                          std::string& endpoint) {
  using namespace arangodb;
  Result res;
  
  // Now look up the actual endpoint:
  auto ci = ClusterInfo::instance();
  if (!ci) {
    return res.reset(TRI_ERROR_SHUTTING_DOWN);
  }
  
  // This sets result.shardId, result.serverId and result.endpoint,
  // depending on what dest is. Note that if a shardID is given, the
  // responsible server is looked up, if a serverID is given, the endpoint
  // is looked up, both can fail and immediately lead to a CL_COMM_ERROR
  // state.
  ServerID serverID;
  if (dest.substr(0, 6) == "shard:") {
    ShardID shardID = dest.substr(6);
    {
      std::shared_ptr<std::vector<ServerID>> resp = ci->getResponsibleServer(shardID);
      if (!resp->empty()) {
        serverID = (*resp)[0];
      } else {
        LOG_TOPIC(ERR, Logger::CLUSTER) << "cannot find responsible server for shard '" << shardID << "'";
        return res.reset(TRI_ERROR_CLUSTER_BACKEND_UNAVAILABLE);
      }
    }
    LOG_TOPIC(DEBUG, Logger::CLUSTER) << "Responsible server: " << serverID;
  } else if (dest.substr(0, 7) == "server:") {
    serverID = dest.substr(7);
  } else if (dest.substr(0, 6) == "tcp://" || dest.substr(0, 6) == "ssl://") {
    endpoint = dest;
    return res;  // all good
  } else {
    std::string errorMessage = "did not understand destination'" + dest + "'";
//    if (logConnectionErrors) {
      LOG_TOPIC(ERR, Logger::COMMUNICATION)
      << "did not understand destination '" << dest << "'";
//    } else {
//      LOG_TOPIC(INFO, Logger::CLUSTER)
//      << "did not understand destination '" << dest << "'";
//    }
    return res.reset(TRI_ERROR_CLUSTER_BACKEND_UNAVAILABLE);
  }

  endpoint = ci->getServerEndpoint(serverID);
  if (endpoint.empty()) {
//    status = CL_COMM_BACKEND_UNAVAILABLE;
    if (serverID.find(',') != std::string::npos) {
      TRI_ASSERT(false);
    }
    std::string errorMessage = "did not find endpoint of server '" + serverID + "'";
//    if (logConnectionErrors) {
      LOG_TOPIC(ERR, Logger::COMMUNICATION)
      << "did not find endpoint of server '" << serverID << "'";
//    } else {
//      LOG_TOPIC(INFO, Logger::CLUSTER)
//      << "did not find endpoint of server '" << serverID << "'";
//    }
    return res.reset(TRI_ERROR_CLUSTER_BACKEND_UNAVAILABLE);;
  }
  return res;
}
  
OperationResult errorCodeFromBody(arangodb::velocypack::Buffer<uint8_t> const& body,
                                  int defaultErrorCode) {
  if (body.size() > 0) {
    return errorCodeFromBody(VPackSlice(body.data()), defaultErrorCode);
  }
  return OperationResult(defaultErrorCode);
}
  
OperationResult errorCodeFromBody(std::shared_ptr<VPackBuilder> const& body,
                                  int defaultErrorCode) {
  if (body) {
    return errorCodeFromBody(body->slice(), defaultErrorCode);
  }
  return OperationResult(defaultErrorCode);
}
  
OperationResult errorCodeFromBody(VPackSlice const& body, int defaultErrorCode) {
  // read the error number from the response and use it if present
  if (body.isObject()) {
    VPackSlice num = body.get(StaticStrings::ErrorNum);
    VPackSlice msg = body.get(StaticStrings::ErrorMessage);
    if (num.isNumber()) {
      if (msg.isString()) {
        // found an error number and an error message, so let's use it!
        return OperationResult(Result(num.getNumericValue<int>(), msg.copyString()));
      }
      // we found an error number, so let's use it!
      return OperationResult(num.getNumericValue<int>());
    }
  }
  
  return OperationResult(defaultErrorCode);
}
  
////////////////////////////////////////////////////////////////////////////////
/// @brief Extract all error baby-style error codes and store them in a map
////////////////////////////////////////////////////////////////////////////////

void errorCodesFromHeaders(network::Headers headers,
                           std::unordered_map<int, size_t>& errorCounter,
                           bool includeNotFound) {
  auto const& codes = headers.find(StaticStrings::ErrorCodes);
  if (codes != headers.end()) {
    auto parsedCodes = VPackParser::fromJson(codes->second);
    VPackSlice codesSlice = parsedCodes->slice();
    TRI_ASSERT(codesSlice.isObject());
    for (auto const& code : VPackObjectIterator(codesSlice)) {
      VPackValueLength codeLength;
      char const* codeString = code.key.getString(codeLength);
      int codeNr = NumberUtils::atoi_zero<int>(codeString, codeString + codeLength);
      if (includeNotFound || codeNr != TRI_ERROR_ARANGO_DOCUMENT_NOT_FOUND) {
        errorCounter[codeNr] += code.value.getNumericValue<size_t>();
      }
    }
  }
}

  
int arangoErrorCode(network::Response const& res) {
  // This function creates an error code from a ClusterCommResult,
  // but only if it is a communication error. If the communication
  // was successful and there was an HTTP error code, this function
  // returns TRI_ERROR_NO_ERROR.
  // If TRI_ERROR_NO_ERROR is returned, then the result was CL_COMM_RECEIVED
  // and .answer can safely be inspected.
  
  switch (fuerte::intToError(res.error)) {
    case fuerte::ErrorCondition::NoError:
      return TRI_ERROR_NO_ERROR;
      
    case fuerte::ErrorCondition::CouldNotConnect:
      return TRI_ERROR_CLUSTER_BACKEND_UNAVAILABLE;
      
    case fuerte::ErrorCondition::CloseRequested:
    case fuerte::ErrorCondition::ConnectionClosed:
      return TRI_ERROR_CLUSTER_CONNECTION_LOST;
      
    case fuerte::ErrorCondition::Timeout: // No reply, we give up:
      return TRI_ERROR_CLUSTER_TIMEOUT;
      
    case fuerte::ErrorCondition::QueueCapacityExceeded: // there is no result
    case fuerte::ErrorCondition::ReadError:
    case fuerte::ErrorCondition::WriteError:
    case fuerte::ErrorCondition::Canceled:
    case fuerte::ErrorCondition::MalformedURL:
    case fuerte::ErrorCondition::ProtocolError:
      return TRI_ERROR_CLUSTER_CONNECTION_LOST;
      
    case fuerte::ErrorCondition::ErrorCastError:
      return TRI_ERROR_INTERNAL;
  }
  
  return TRI_ERROR_INTERNAL;
}
  
/// @brief Create Cluster Communication result for insert
OperationResult clusterResultInsert(arangodb::fuerte::StatusCode code,
                                    std::shared_ptr<VPackBuffer<uint8_t>> body,
                                    OperationOptions const& options,
                                    std::unordered_map<int, size_t> const& errorCounter) {
  switch (code) {
    case fuerte::StatusAccepted:
      return OperationResult(Result(), std::move(body), nullptr, options, errorCounter);
    case fuerte::StatusCreated: {
      OperationOptions copy = options;
      copy.waitForSync = true; // wait for sync is abused herea
      // operationResult should get a return code.
      return OperationResult(Result(), std::move(body), nullptr, copy, errorCounter);
    }
    case fuerte::StatusPreconditionFailed:
      return network::errorCodeFromBody(*body, TRI_ERROR_ARANGO_CONFLICT);
    case fuerte::StatusBadRequest:
      return network::errorCodeFromBody(*body, TRI_ERROR_INTERNAL);
    case fuerte::StatusNotFound:
      return network::errorCodeFromBody(*body, TRI_ERROR_ARANGO_DATA_SOURCE_NOT_FOUND);
    case fuerte::StatusConflict:
      return network::errorCodeFromBody(*body, TRI_ERROR_ARANGO_UNIQUE_CONSTRAINT_VIOLATED);
    default:
      return network::errorCodeFromBody(*body, TRI_ERROR_INTERNAL);
  }
}
}} // arangodb::network
