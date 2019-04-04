/*jshint globalstrict:false, strict:false */
/* global fail, getOptions, assertTrue, assertEqual, assertNotEqual, assertUndefined */

////////////////////////////////////////////////////////////////////////////////
/// @brief teardown for dump/reload tests
///
/// @file
///
/// DISCLAIMER
///
/// Copyright 2010-2012 triagens GmbH, Cologne, Germany
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
/// Copyright holder is ArangoDB Inc, Cologne, Germany
///
/// @author Wilfried Goesgens
/// @author Copyright 2019, ArangoDB Inc, Cologne, Germany
////////////////////////////////////////////////////////////////////////////////

const fs = require('fs');
const internal = require('internal');

const rootDir = fs.join(fs.getTempPath(),  'permissions');
const testresults = fs.join(rootDir, 'testresult.json'); // where we want to put our results ;-)
const topLevelForbidden = fs.join(rootDir, 'forbidden');
const topLevelAllowed = fs.join(rootDir, 'allowed');

const topLevelAllowedFile = fs.join(topLevelAllowed, 'allowed.txt');
const topLevelForbiddenFile = fs.join(topLevelForbidden, 'forbidden.txt');

// N/A const subLevelForbidden = fs.join(topLevelAllowed, 'forbidden');
const subLevelAllowed = fs.join(topLevelForbidden, 'allowed');

const subLevelAllowedFile = fs.join(subLevelAllowed, 'allowed.txt');
// N/A const subLevelForbiddenFile = fs.join(subLevelForbidden, 'forbidden.txt');

const topLevelAllowedWriteFile = fs.join(topLevelAllowed, 'allowed_write.txt');
const topLevelForbiddenWriteFile = fs.join(topLevelForbidden, 'forbidden_write.txt');
const subLevelAllowedWriteFile = fs.join(subLevelAllowed, 'allowed_write.txt');
// N/A const subLevelForbiddenWriteFile = fs.join(subLevelForbidden, 'forbidden_write.txt');

const topLevelAllowedReadCSVFile = fs.join(topLevelAllowed, 'allowed_csv.txt');
const topLevelForbiddenReadCSVFile = fs.join(topLevelForbidden, 'forbidden_csv.txt');
const subLevelAllowedReadCSVFile = fs.join(subLevelAllowed, 'allowed_csv.txt');
// N/A const subLevelForbiddenReadCSVFile = fs.join(subLevelForbidden, 'forbidden_csv.txt');

const topLevelAllowedReadJSONFile = fs.join(topLevelAllowed, 'allowed_json.txt');
const topLevelForbiddenReadJSONFile = fs.join(topLevelForbidden, 'forbidden_json.txt');
const subLevelAllowedReadJSONFile = fs.join(subLevelAllowed, 'allowed_json.txt');
// N/A const subLevelForbiddenReadJSONFile = fs.join(subLevelForbidden, 'forbidden_json.txt');

const CSV = 'a,b\n1,2\n3,4\n';
const CSVParsed = [['a', 'b'], ['1', '2'], ['3', '4']];
const JSONText = '{"a": true, "b":false, "c": "abc"}\n{"a": true, "b":false, "c": "abc"}';
const JSONParsed = { "a" : true, "b" : false, "c" : "abc"};

if (getOptions === true) {
  // N/A fs.makeDirectoryRecursive(subLevelForbidden);
  fs.makeDirectoryRecursive(topLevelAllowed);
  fs.makeDirectoryRecursive(subLevelAllowed);
  fs.write(topLevelAllowedFile, 'this file is allowed.\n');
  fs.write(topLevelForbiddenFile, 'forbidden fruits are tasty!\n');
  fs.write(subLevelAllowedFile, 'this file is allowed.\n');
   // N/A fs.write(subLevelForbiddenFile, 'forbidden fruits are tasty!\n');

  fs.write(topLevelAllowedReadCSVFile, CSV);
  fs.write(topLevelForbiddenReadCSVFile, CSV);
  fs.write(subLevelAllowedReadCSVFile, CSV);

  fs.write(topLevelAllowedReadJSONFile, JSONText);
  fs.write(topLevelForbiddenReadJSONFile, JSONText);
  fs.write(subLevelAllowedReadJSONFile, JSONText);

  return {
    'temp.path': fs.getTempPath(),     // Adjust the temp-path to match our current temp path
    'javascript.files-black-list': [
      '/var/lib/.*', // that for sure!
      '/var/log/.*', // that for sure!
      '/etc/passwd', // if not this, what else?
      '/etc/.*',
      topLevelForbidden + '.*',
      // N/A  subLevelForbidden + '.*'
    ],
    'javascript.files-white-list': [
      testresults,
      topLevelAllowed + '.*',
      subLevelAllowed + '.*'
    ]
  };
}

var jsunity = require('jsunity');
var env = require('process').env;
var arangodb = require("@arangodb");
const base64Encode = require('internal').base64Encode;
function testSuite() {
  function tryReadForbidden(fn) {
    try {
      fs.read(fn);
      fail();
    }
    catch (err) {
      assertEqual(arangodb.ERROR_FORBIDDEN, err.errorNum, 'access to ' + fn + ' wasn\'t forbidden');
    }
  }
  function tryReadAllowed(fn, expectedContent) {
    let content = fs.read(fn);
    assertEqual(content,
                expectedContent,
                'Expected ' + fn + ' to contain "' + expectedContent + '" but it contained: "' + content + '"!');
  }
  function tryReadBufferForbidden(fn) {
    try {
      fs.readBuffer(fn);
      fail();
    }
    catch (err) {
      assertEqual(arangodb.ERROR_FORBIDDEN, err.errorNum, 'access to ' + fn + ' wasn\'t forbidden');
    }
  }
  function tryReadBufferAllowed(fn, expectedContent) {
    let content = fs.readBuffer(fn);
    assertEqual(content.toString(),
                expectedContent,
                'Expected ' + fn + ' to contain "' + expectedContent + '" but it contained: "' + content + '"!');
  }
  function tryRead64Forbidden(fn) {
    try {
      fs.read64(fn);
      fail();
    }
    catch (err) {
      assertEqual(arangodb.ERROR_FORBIDDEN, err.errorNum, 'access to ' + fn + ' wasn\'t forbidden');
    }
  }
  function tryRead64Allowed(fn, expectedContentPlain) {
    let expectedContent = base64Encode(expectedContentPlain);
    let content = fs.read64(fn);
    assertEqual(content,
                expectedContent,
                'Expected ' + fn + ' to contain "' + expectedContent + '" but it contained: "' + content + '"!');
  }
  function tryReadCSVForbidden(fn) {
    try {
      internal.processCsvFile(fn, function (raw_row, index) {
      });
      fail();
    }
    catch (err) {
      assertEqual(arangodb.ERROR_FORBIDDEN, err.errorNum, 'access to ' + fn + ' wasn\'t forbidden');
    }
  }
  function tryReadCSVAllowed(fn) {
    let CSVContent = [];
    let content = internal.processCsvFile(fn, function (raw_row, index) {
      CSVContent.push(raw_row);
    });
    
    assertEqual(CSVContent,
                CSVParsed,
                'Expected ' + fn + ' to contain "' + CSVParsed + '" but it contained: "' + CSVContent + '"!');
  }
  function tryReadJSONForbidden(fn) {
    try {
      internal.processJsonFile(fn, function (raw_row, index) {
      });
      fail();
    }
    catch (err) {
      assertEqual(arangodb.ERROR_FORBIDDEN, err.errorNum, 'access to ' + fn + ' wasn\'t forbidden');
    }
  }
  function tryReadJSONAllowed(fn, expectedContentPlain) {
    let count = 0;
    let content = internal.processJsonFile(fn, function (raw_row, index) {
      assertEqual(raw_row,
                  JSONParsed,
                  'Expected ' + fn + ' to contain "' + JSONParsed + '" but it contained: "' + raw_row + '"!');
      count ++;
    });
    assertEqual(count, 2);
  }
  function tryWriteForbidden(fn) {
    try {
      let rc = fs.write(fn, '1212 this is just a test');
      fail();
    }
    catch (err) {
      assertEqual(arangodb.ERROR_FORBIDDEN, err.errorNum, 'Write access to ' + fn + ' wasn\'t forbidden');
    }
  }
  function tryWriteAllowed(fn) {
    let rc = fs.write(fn, '1212 this is just a test');
    assertTrue(rc, 'Expected ' + fn + ' to be chmodable');
  }

  function tryChmodForbidden(fn) {
    try {
      let rc = fs.chmod(fn, '0755');
      fail();
    }
    catch (err) {
      assertEqual(arangodb.ERROR_FORBIDDEN, err.errorNum, 'chmod access to ' + fn + ' wasn\'t forbidden');
    }
  }
  function tryChmodAllowed(fn) {
    let rc = fs.chmod(fn, '0755');
    assertTrue(rc, 'Expected ' + fn + ' to be writeable');
  }

  function tryExistsForbidden(fn) {
    try {
      let rc = fs.exists(fn);
      fail();
    }
    catch (err) {
      assertEqual(arangodb.ERROR_FORBIDDEN, err.errorNum, 'stat-access to ' + fn + ' wasn\'t forbidden');
    }
  }
  function tryExistsAllowed(fn) {
    let rc = fs.exists(fn);
    assertTrue(rc, 'Expected ' + fn + ' to be stat-eable');
  }

  function tryFileSizeForbidden(fn) {
    try {
      let rc = fs.size(fn);
      fail();
    }
    catch (err) {
      assertEqual(arangodb.ERROR_FORBIDDEN, err.errorNum, 'stat-access to ' + fn + ' wasn\'t forbidden');
    }
  }
  function tryFileSizeAllowed(fn) {
    let rc = fs.size(fn);
    assertTrue(rc, 'Expected ' + fn + ' to be stat-eable');
  }

  function tryIsDirectoryForbidden(fn) {
    try {
      let rc = fs.isDirectory(fn);
      fail();
    }
    catch (err) {
      assertEqual(arangodb.ERROR_FORBIDDEN, err.errorNum, 'isDirectory-access to ' + fn + ' wasn\'t forbidden');
    }
  }
  function tryIsDirectoryAllowed(fn, isDirectory) {
    let rc = fs.isDirectory(fn);
    assertEqual(rc, isDirectory, 'Expected ' + fn + ' to be a ' + isDirectory ? "directory.":"file.");
  }

  function tryCreateDirectoryForbidden(fn) {
    try {
      let rc = fs.makeDirectory(fn);
      fail();
    }
    catch (err) {
      assertEqual(arangodb.ERROR_FORBIDDEN, err.errorNum, 'createDirectory creation of ' + fn + ' wasn\'t forbidden');
    }
  }
  function tryCreateDirectoryAllowed(fn) {
    let rc = fs.makeDirectory(fn);
    assertUndefined(rc, 'Expected ' + fn + ' to become a directory.');
    tryIsDirectoryAllowed(fn, true);
  }

  function tryRemoveDirectoryForbidden(fn) {
    try {
      let rc = fs.removeDirectory(fn);
      fail();
    }
    catch (err) {
      assertEqual(arangodb.ERROR_FORBIDDEN, err.errorNum, 'removeDirectory deleting of ' + fn + ' wasn\'t forbidden');
    }
  }
  function tryRemoveDirectoryAllowed(fn) {
    let rc = fs.removeDirectory(fn);
    assertUndefined(rc, 'Expected ' + fn + ' to become a directory.');
    tryIsDirectoryAllowed(fn, false);
  }

  function tryCreateDirectoryRecursiveForbidden(fn) {
    try {
      let rc = fs.makeDirectoryRecursive(fn);
      fail();
    }
    catch (err) {
      assertEqual(arangodb.ERROR_FORBIDDEN, err.errorNum, 'createDirectory creation of ' + fn + ' wasn\'t forbidden');
    }
  }
  function tryCreateDirectoryRecursiveAllowed(fn) {
    let rc = fs.makeDirectoryRecursive(fn);
    assertUndefined(rc, 'Expected ' + fn + ' to become a directory.');
    tryIsDirectoryAllowed(fn, true);
  }

  function tryRemoveDirectoryRecursiveForbidden(fn) {
    try {
      let rc = fs.removeDirectoryRecursive(fn);
      fail();
    }
    catch (err) {
      assertEqual(arangodb.ERROR_FORBIDDEN, err.errorNum, 'removeDirectoryRecursive deletion of ' + fn + ' wasn\'t forbidden');
    }
  }
  function tryRemoveDirectoryRecursiveAllowed(fn) {
    let rc = fs.removeDirectoryRecursive(fn);
    assertUndefined(rc, 'Expected ' + fn + ' to be removed.');
    tryIsDirectoryAllowed(fn, false);
  }

  function tryIsFileForbidden(fn) {
    try {
      let rc = fs.isFile(fn);
      fail();
    }
    catch (err) {
      assertEqual(arangodb.ERROR_FORBIDDEN, err.errorNum, 'isFile-access to ' + fn + ' wasn\'t forbidden');
    }
  }
  function tryIsFileAllowed(fn, isFile) {
    let rc = fs.isFile(fn);
    assertEqual(rc, isFile, 'Expected ' + fn + ' to be a ' + isFile ? "file.":"directory.");
  }

  function tryListFileForbidden(dn) {
    try {
      let rc = fs.list(dn);
      fail();
    }
    catch (err) {
      assertEqual(arangodb.ERROR_FORBIDDEN, err.errorNum, 'ListFile-access to ' + dn + ' wasn\'t forbidden');
    }
  }
  function tryListFileAllowed(dn, expectCount) {
    let rc = fs.list(dn);
    assertEqual(rc.length, expectCount, 'Expected ' + dn + ' to contain ' + expectCount + " files.");
  }

  function tryListTreeForbidden(dn) {
    try {
      let rc = fs.listTree(dn);
      fail();
    }
    catch (err) {
      assertEqual(arangodb.ERROR_FORBIDDEN, err.errorNum, 'ListTree-access to ' + dn + ' wasn\'t forbidden');
    }
  }
  function tryListTreeAllowed(dn, expectCount) {
    let rc = fs.listTree(dn);
    assertEqual(rc.length, expectCount, 'Expected ' + dn + ' to contain ' + expectCount + " files.");
  }

  return {
    testReadFile : function() {
      tryReadForbidden('/etc/passwd');
      tryReadForbidden('/var/log/mail.log');
      tryReadForbidden(topLevelForbiddenFile);
      // N/A tryReadForbidden(subLevelForbiddenFile);

      tryReadAllowed(topLevelAllowedFile, 'this file is allowed.\n');
      tryReadAllowed(subLevelAllowedFile, 'this file is allowed.\n');
    },
    testReadBuffer : function() {
      tryReadBufferForbidden('/etc/passwd');
      tryReadBufferForbidden('/var/log/mail.log');
      tryReadBufferForbidden(topLevelForbiddenFile);
      // N/A tryReadForbidden(subLevelForbiddenFile);

      tryReadBufferAllowed(topLevelAllowedFile, 'this file is allowed.\n');
      tryReadBufferAllowed(subLevelAllowedFile, 'this file is allowed.\n');
    },
    testRead64File : function() {

      tryRead64Forbidden('/etc/passwd');
      tryRead64Forbidden('/var/log/mail.log');
      tryRead64Forbidden(topLevelForbiddenFile);
      // N/A tryReadForbidden(subLevelForbiddenFile);

      tryRead64Allowed(topLevelAllowedFile, 'this file is allowed.\n');
      tryRead64Allowed(subLevelAllowedFile, 'this file is allowed.\n');
    },
    testReadCSVFile : function() {
      tryReadCSVForbidden('/etc/passwd');
      tryReadCSVForbidden('/var/log/mail.log');
      tryReadCSVForbidden(topLevelForbiddenReadCSVFile);
      // N/A tryReadCSVForbidden(subLevelForbiddenReadCSVFile);

      tryReadCSVAllowed(topLevelAllowedReadCSVFile, CSV);
      tryReadCSVAllowed(subLevelAllowedReadCSVFile, CSV);
    },
    testReadJSONFile : function() {
      tryReadJSONForbidden('/etc/passwd');
      tryReadJSONForbidden('/var/log/mail.log');
      tryReadJSONForbidden(topLevelForbiddenReadJSONFile);
      // N/A tryReadJSONForbidden(subLevelForbiddenReadJSONFile);

      tryReadJSONAllowed(topLevelAllowedReadJSONFile, JSONText);
      tryReadJSONAllowed(subLevelAllowedReadJSONFile, JSONText);
    },
    testWriteFile : function() {
      tryWriteForbidden('/var/log/mail.log');
      tryWriteForbidden(topLevelForbiddenWriteFile);

      tryWriteAllowed(topLevelAllowedWriteFile);
      tryWriteAllowed(subLevelAllowedWriteFile);

    },
    testChmod : function() {
      tryChmodForbidden('/etc/passwd');
      tryChmodForbidden('/var/log/mail.log');
      tryChmodForbidden(topLevelForbiddenFile);
      // N/A tryChmodForbidden(subLevelForbiddenFile);

      tryChmodAllowed(topLevelAllowedFile);
      tryChmodAllowed(subLevelAllowedFile);
    },
    testExists : function() {
      tryExistsForbidden('/etc/passwd');
      tryExistsForbidden('/var/log/mail.log');
      tryExistsForbidden(topLevelForbiddenFile);
      // N/A tryExistsForbidden(subLevelForbiddenFile);

      tryExistsAllowed(topLevelAllowedFile);
      tryExistsAllowed(subLevelAllowedFile);
    },
    testFileSize : function() {
      tryFileSizeForbidden('/etc/passwd');
      tryFileSizeForbidden('/var/log/mail.log');
      tryFileSizeForbidden(topLevelForbiddenFile);
      // N/A tryFileSizeForbidden(subLevelForbiddenFile);

      tryFileSizeAllowed(topLevelAllowedFile);
      tryFileSizeAllowed(subLevelAllowedFile);
    },
    testIsDirectory : function() {
      tryIsDirectoryForbidden('/etc/passwd');
      tryIsDirectoryForbidden('/var/log/mail.log');
      tryIsDirectoryForbidden(topLevelForbiddenFile);
      // N/A tryFileSizeForbidden(subLevelForbiddenFile);

      tryIsDirectoryAllowed(topLevelAllowedFile, false);
      tryIsDirectoryAllowed(subLevelAllowedFile, false);

      tryIsDirectoryAllowed(topLevelAllowed, true);
      tryIsDirectoryAllowed(subLevelAllowed, true);
    },
    testCreateRemoveDirectory : function() {
      tryCreateDirectoryForbidden('/etc/abc');
      tryCreateDirectoryForbidden('/var/log/busted');
      tryCreateDirectoryForbidden(fs.join(topLevelForbiddenFile, "forbidden"));

      tryCreateDirectoryAllowed(fs.join(topLevelAllowed, "allowed_create_dir"));
      tryCreateDirectoryAllowed(fs.join(subLevelAllowed, "allowed_create_dir"));

      tryRemoveDirectoryForbidden('/etc/abc');
      tryRemoveDirectoryForbidden('/var/log/busted');
      tryRemoveDirectoryForbidden(fs.join(topLevelForbiddenFile, "forbidden"));

      tryRemoveDirectoryAllowed(fs.join(topLevelAllowed, "allowed_create_dir"));
      tryRemoveDirectoryAllowed(fs.join(subLevelAllowed, "allowed_create_dir"));
    },
    testCreateRemoveDirectoryRecursive : function() {
      tryCreateDirectoryRecursiveForbidden('/etc/cde/fdg');
      tryCreateDirectoryRecursiveForbidden('/var/log/with/sub/dir');
      tryCreateDirectoryRecursiveForbidden(fs.join(topLevelForbiddenFile, "forbidden", 'sub', 'directory'));

      tryCreateDirectoryRecursiveAllowed(fs.join(topLevelAllowed, 'allowed_create_recursive_dir', 'directory'));
      tryCreateDirectoryRecursiveAllowed(fs.join(subLevelAllowed, 'allowed_create_recursive_dir', 'directory'));

      tryRemoveDirectoryRecursiveForbidden('/etc/cde/fdg');
      tryRemoveDirectoryRecursiveForbidden('/var/log/with/sub/dir');
      tryRemoveDirectoryRecursiveForbidden(fs.join(topLevelForbiddenFile, "forbidden", 'sub', 'directory'));

      tryRemoveDirectoryRecursiveAllowed(fs.join(topLevelAllowed, 'allowed_create_recursive_dir', 'directory'));
      tryRemoveDirectoryRecursiveAllowed(fs.join(subLevelAllowed, 'allowed_create_recursive_dir', 'directory'));
    },
    testIsFile : function() {
      tryIsFileForbidden('/etc/passwd');
      tryIsFileForbidden('/var/log/mail.log');
      tryIsFileForbidden(topLevelForbiddenFile);
      // N/A tryFileSizeForbidden(subLevelForbiddenFile);

      tryIsFileAllowed(topLevelAllowedFile, true);
      tryIsFileAllowed(subLevelAllowedFile, true);

      tryIsFileAllowed(topLevelAllowed, false);
      tryIsFileAllowed(subLevelAllowed, false);
    },
    testListFile : function() {
      tryListFileForbidden('/etc/X11');
      tryListFileForbidden('/var/log/');
      tryListFileForbidden(topLevelForbidden);
      tryListFileForbidden(topLevelForbiddenFile);
      // N/A tryFileSizeForbidden(subLevelForbiddenFile);

      tryListFileAllowed(topLevelAllowedFile, 0);
      tryListFileAllowed(subLevelAllowedFile, 0);

      tryListFileAllowed(topLevelAllowed, 5);
      tryListFileAllowed(subLevelAllowed, 5);
    },
    testListTree : function() {
      tryListTreeForbidden('/etc/X11');
      tryListTreeForbidden('/var/log/');
      tryListTreeForbidden(topLevelForbidden);
      tryListTreeForbidden(topLevelForbiddenFile);
      // N/A tryFileSizeForbidden(subLevelForbiddenFile);

      tryListTreeAllowed(topLevelAllowedFile, 1);
      tryListTreeAllowed(subLevelAllowedFile, 1);

      tryListTreeAllowed(topLevelAllowed, 6);
      tryListTreeAllowed(subLevelAllowed, 6);
    }
  };
}
jsunity.run(testSuite);
return jsunity.done();
