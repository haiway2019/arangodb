////////////////////////////////////////////////////////////////////////////////
/// DISCLAIMER
///
/// Copyright 2014-2016 ArangoDB GmbH, Cologne, Germany
/// Copyright 2004-2014 triAGENS GmbH, Cologne, Germany
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
/// @author Jan Steemann
////////////////////////////////////////////////////////////////////////////////

#include "ServerJob.h"

#include "Basics/MutexLocker.h"
#include "Cluster/ClusterInfo.h"
#include "Cluster/HeartbeatThread.h"
#include "Dispatcher/DispatcherQueue.h"
#include "Logger/Logger.h"
#include "RestServer/DatabaseFeature.h"
#include "V8/v8-utils.h"
#include "V8Server/V8Context.h"
#include "V8Server/V8DealerFeature.h"
#include "VocBase/server.h"
#include "VocBase/vocbase.h"

#include <iostream>

using namespace arangodb;
using namespace arangodb::application_features;
using namespace arangodb::rest;

static arangodb::Mutex ExecutorLock;

////////////////////////////////////////////////////////////////////////////////
/// @brief constructs a new db server job
////////////////////////////////////////////////////////////////////////////////

ServerJob::ServerJob(HeartbeatThread* heartbeat)
    : Job("HttpServerJob"),
      _heartbeat(heartbeat),
      _shutdown(0),
      _abandon(false) {}

////////////////////////////////////////////////////////////////////////////////
/// @brief destructs a db server job
////////////////////////////////////////////////////////////////////////////////

ServerJob::~ServerJob() {}

void ServerJob::work() {
  LOG(TRACE) << "starting plan update handler";

  if (_shutdown != 0) {
    return;
  }

  _heartbeat->setReady();

  bool result;

  {
    // only one plan change at a time
    MUTEX_LOCKER(mutexLocker, ExecutorLock);

    result = execute();
  }

  _heartbeat->removeDispatchedJob(result);
}

bool ServerJob::cancel() { return false; }

void ServerJob::cleanup(DispatcherQueue* queue) {
  queue->removeJob(this);
  delete this;
}

////////////////////////////////////////////////////////////////////////////////
/// @brief execute job
////////////////////////////////////////////////////////////////////////////////

bool ServerJob::execute() {
  // default to system database

  DatabaseFeature* database = dynamic_cast<DatabaseFeature*>(
    ApplicationServer::lookupFeature("Database"));

  TRI_vocbase_t* const vocbase = database->vocbase();

  if (vocbase == nullptr) {

    std::cout << "+++++++++++++ oops ++++++++++++++" << std::endl;
    // database is gone
    return false;
  }

  TRI_DEFER(TRI_ReleaseVocBase(vocbase));

  V8Context* context = V8DealerFeature::DEALER->enterContext(vocbase, true);

  if (context == nullptr) {
    return false;
  }

  bool ok = true;
  auto isolate = context->_isolate;

  try {
    v8::HandleScope scope(isolate);

    // execute script inside the context
    auto file = TRI_V8_ASCII_STRING("handle-plan-change");
    auto content =
        TRI_V8_ASCII_STRING("require('@arangodb/cluster').handlePlanChange();");
    v8::Handle<v8::Value> res = TRI_ExecuteJavaScriptString(
        isolate, isolate->GetCurrentContext(), content, file, false);
    if (res->IsBoolean() && res->IsTrue()) {
      LOG(ERR) << "An error occurred whilst executing the handlePlanChange in "
                  "JavaScript.";
      ok = false;  // The heartbeat thread will notice this!
    }
    // invalidate our local cache, even if an error occurred
    ClusterInfo::instance()->flush();
  } catch (...) {
  }

  V8DealerFeature::DEALER->exitContext(context);

  return ok;
}
