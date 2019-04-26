/*jshint globalstrict:false, strict:false */
/*global assertEqual, assertTrue, assertMatch, fail */

////////////////////////////////////////////////////////////////////////////////
/// @brief tests for client/server side transaction invocation
///
/// @file
///
/// DISCLAIMER
///
/// Copyright 2019 ArangoDB GmbH, Cologne, Germany
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

const jsunity = require("jsunity");
const arangodb = require("@arangodb");
const analyzers = require("@arangodb/analyzers");
const internal = require("internal");
const ERRORS = arangodb.errors;
const ArangoError = require("@arangodb").ArangoError;
const db = arangodb.db;

const qq = `FOR doc IN UnitTestsView 
              SEARCH ANALYZER(doc.text IN TOKENS('the quick brown', 'text_en'), 'text_en') 
              OPTIONS { waitForSync : true } 
              SORT TFIDF(doc) 
              LIMIT 4 
              RETURN doc`;

////////////////////////////////////////////////////////////////////////////////
/// @brief test suite
////////////////////////////////////////////////////////////////////////////////

function TransactionsIResearchSuite() {
  'use strict';
  let c = null;
  let view = null;

  return {

    setUpAll: function() {
      analyzers.save(db._name() + "::text_en", "text", "{ \"locale\": \"en.UTF-8\", \"ignored_words\": [ ] }", 
                      [ "frequency", "norm", "position" ]);
    },

    ////////////////////////////////////////////////////////////////////////////////
    /// @brief set up
    ////////////////////////////////////////////////////////////////////////////////

    setUp: function () {
      db._drop('UnitTestsCollection');
      c = db._create('UnitTestsCollection');
    },

    ////////////////////////////////////////////////////////////////////////////////
    /// @brief tear down
    ////////////////////////////////////////////////////////////////////////////////

    tearDown: function () {
      // we need try...catch here because at least one test drops the collection itself!
      try {
        c.unload();
        c.drop();
      } catch (err) {
      }
      c = null;
      if (view) {
        view.drop();
        view = null;
      }
      internal.wait(0.0);
    },

    ////////////////////////////////////////////////////////////////////////////
    /// @brief should honor rollbacks of inserts
    ////////////////////////////////////////////////////////////////////////////
    testRollbackInsertWithLinks1 : function () {

      let meta = { links: { 'UnitTestsCollection' : { fields: {text: {analyzers: [ "text_en" ] } } } } };
      view = db._createView("UnitTestsView", "arangosearch", {});
      view.properties(meta);
      let links = view.properties().links;
      assertNotEqual(links['UnitTestsCollection'], undefined);

      c.save({ _key: "full", text: "the quick brown fox jumps over the lazy dog" });
      c.save({ _key: "half", text: "quick fox over lazy" });

      try {
        db._executeTransaction({
          collections: {write: 'UnitTestsCollection'},
          action: function() {
            const db = require('internal').db;
  
            c.save({ _key: "other_half", text: "the brown jumps the dog" });
            c.save({ _key: "quarter", text: "quick over" });
  
            let result = db._query(qq).toArray();
            assertEqual(result.length, 4);
            assertEqual(result[0]._key, 'half');
            assertEqual(result[1]._key, 'quarter');
            assertEqual(result[2]._key, 'other_half');
            assertEqual(result[3]._key, 'full');
            throw "myerror";
          }
        });
      } catch (err) {
        assertEqual(err.errorMessage, "myerror");
      }

      let result = db._query(qq).toArray();
      assertEqual(result.length, 2);
      assertEqual(result[0]._key, 'half');
      //assertEqual(result[1]._key, 'quarter');
      //assertEqual(result[1]._key, 'other_half');
      assertEqual(result[1]._key, 'full');
    },

    ////////////////////////////////////////////////////////////////////////////
    /// @brief should honor rollbacks of inserts
    ////////////////////////////////////////////////////////////////////////////
    testRollbackInsertWithLinks2 : function () {
      c.ensureIndex({type: 'hash', fields:['val'], unique: true});

      let meta = { links: { 'UnitTestsCollection' : { fields: {text: {analyzers: [ "text_en" ] } } } } };
      view = db._createView("UnitTestsView", "arangosearch", {});
      view.properties(meta);
      let links = view.properties().links;
      assertNotEqual(links['UnitTestsCollection'], undefined);

      db._executeTransaction({
        collections: {write: 'UnitTestsCollection'},
        action: function() {
          const db = require('internal').db;
          c.save({ _key: "full", text: "the quick brown fox jumps over the lazy dog", val: 1 });
          c.save({ _key: "half", text: "quick fox over lazy", val: 2 });
          c.save({ _key: "other_half", text: "the brown jumps the dog", val: 3 });

          try {
            c.save({ _key: "quarter", text: "quick over", val: 3 });
            fail();
          } catch(err) {
            assertEqual(err.errorNum, ERRORS.ERROR_ARANGO_UNIQUE_CONSTRAINT_VIOLATED.code);
          }

          let result = db._query(qq).toArray();
          assertEqual(result.length, 3);
          assertEqual(result[0]._key, 'half');
          //assertEqual(result[1]._key, 'quarter');
          assertEqual(result[1]._key, 'other_half');
          assertEqual(result[2]._key, 'full');
        }
      });

      let result = db._query(qq).toArray();
      assertEqual(result.length, 3);
      assertEqual(result[0]._key, 'half');
      //assertEqual(result[1]._key, 'quarter');
      assertEqual(result[1]._key, 'other_half');
      assertEqual(result[2]._key, 'full');
    },

    ////////////////////////////////////////////////////////////////////////////
    /// @brief should honor rollbacks of inserts
    ////////////////////////////////////////////////////////////////////////////
    testRollbackInsertWithLinks3 : function () {
      let meta = { links: { 'UnitTestsCollection' : { fields: {text: {analyzers: [ "text_en" ] } } } } };
      view = db._createView("UnitTestsView", "arangosearch", {});
      view.properties(meta);
      let links = view.properties().links;
      assertNotEqual(links['UnitTestsCollection'], undefined);

      c.ensureIndex({type: 'hash', fields:['val'], unique: true});

      db._executeTransaction({
        collections: {write: 'UnitTestsCollection'},
        action: function() {
          const db = require('internal').db;
          c.save({ _key: "full", text: "the quick brown fox jumps over the lazy dog", val: 1 });
          c.save({ _key: "half", text: "quick fox over lazy", val: 2 });
          c.save({ _key: "other_half", text: "the brown jumps the dog", val: 3 });

          try {
            c.save({ _key: "quarter", text: "quick over", val: 3 });
            fail();
          } catch(err) {
            assertEqual(err.errorNum, ERRORS.ERROR_ARANGO_UNIQUE_CONSTRAINT_VIOLATED.code);
          }

          let result = db._query(qq).toArray();
          assertEqual(result.length, 3);
          assertEqual(result[0]._key, 'half');
          //assertEqual(result[1]._key, 'quarter');
          assertEqual(result[1]._key, 'other_half');
          assertEqual(result[2]._key, 'full');
        }
      });

      let result = db._query(qq).toArray();
      assertEqual(result.length, 3);
      assertEqual(result[0]._key, 'half');
      //assertEqual(result[1]._key, 'quarter');
      assertEqual(result[1]._key, 'other_half');
      assertEqual(result[2]._key, 'full');
    },

    ////////////////////////////////////////////////////////////////////////////
    /// @brief should honor rollbacks of inserts
    ////////////////////////////////////////////////////////////////////////////
    testRollbackRemovalWithLinks1 : function () {
      c.ensureIndex({type: 'hash', fields:['val'], unique: true});

      let meta = { links: { 'UnitTestsCollection' : { fields: {text: {analyzers: [ "text_en" ] } } } } };
      view = db._createView("UnitTestsView", "arangosearch", {});
      view.properties(meta);
      let links = view.properties().links;
      assertNotEqual(links['UnitTestsCollection'], undefined);

      c.save({ _key: "full", text: "the quick brown fox jumps over the lazy dog", val: 1 });
      c.save({ _key: "half", text: "quick fox over lazy", val: 2 });
      c.save({ _key: "other_half", text: "the brown jumps the dog", val: 3 });
      c.save({ _key: "quarter", text: "quick over", val: 4 });

      try {
        db._executeTransaction({
          collections: {write: 'UnitTestsCollection'},
          action: function() {
            const db = require('internal').db;
            let c = db._collection('UnitTestsCollection');
            c.remove("full");
            c.remove("half");
            c.remove("other_half");
            c.remove("quarter");
            throw "myerror";
          }
        });
      } catch(err) {
        assertEqual(err.errorMessage, "myerror");
      }

      let result = db._query(qq).toArray();
      print(result);
      assertEqual(result.length, 4);
      assertEqual(result[0]._key, 'half');
      assertEqual(result[1]._key, 'quarter');
      assertEqual(result[2]._key, 'other_half');
      assertEqual(result[3].nam_keye, 'full');
    },

    ////////////////////////////////////////////////////////////////////////////
    /// @brief should honor rollbacks of inserts
    ////////////////////////////////////////////////////////////////////////////
    /*testRollbackRemovalWithLinks2 : function () {
      c.ensureIndex({type: 'hash', fields:['val'], unique: true});

      let meta = { links: { 'UnitTestsCollection' : { fields: {text: {analyzers: [ "text_en" ] } } } } };
      view = db._createView("UnitTestsView", "arangosearch", {});
      view.properties(meta);
      let links = view.properties().links;
      assertNotEqual(links['UnitTestsCollection'], undefined);

      c.save({ name: "full", text: "the quick brown fox jumps over the lazy dog", val: 1 });
      c.save({ name: "half", text: "quick fox over lazy", val: 2 });
      let d = c.save({ name: "other half", text: "the brown jumps the dog", val: 3 });

      db._executeTransaction({
        collections: {write: 'UnitTestsCollection'},
        action: function() {
          const db = require('internal').db;

          require('internal').debugSetFailAt("RocksDBVPackIndex::remove");
          try {
            db._collection('UnitTestsCollection').remove(d._key);
            fail();
          } catch(err) {
            assertEqual(err.errorNum, ERRORS.ERROR_DEBUG.code);
          }
          c.save({ name: "quarter", text: "quick over", val: 4 });
        }
      });

      let result = db._query(qq).toArray();
      print(result);
      assertEqual(result.length, 4);
      assertEqual(result[0].name, 'half');
      assertEqual(result[1].name, 'quarter');
      assertEqual(result[2].name, 'other half');
      assertEqual(result[3].name, 'full');
    },

    ////////////////////////////////////////////////////////////////////////////
    /// @brief should honor rollbacks of inserts
    ////////////////////////////////////////////////////////////////////////////
    testRollbackRemovalWithLinks3 : function () {

      let meta = { links: { 'UnitTestsCollection' : { fields: {text: {analyzers: [ "text_en" ] } } } } };
      view = db._createView("UnitTestsView", "arangosearch", {});
      view.properties(meta);
      let links = view.properties().links;
      assertNotEqual(links['UnitTestsCollection'], undefined);

      c.ensureIndex({type: 'hash', fields:['val'], unique: true});

      c.save({ name: "full", text: "the quick brown fox jumps over the lazy dog", val: 1 });
      db._executeTransaction({
        collections: {write: 'UnitTestsCollection'},
        action: function() {
          const db = require('internal').db;

          let d = c.save({ name: "half", text: "quick fox over lazy", val: 2 });
          require('internal').debugSetFailAt("RocksDBVPackIndex::remove");
          try {
            db._collection('UnitTestsCollection').remove(d._key);
            fail();
          } catch(err) {
            assertEqual(err.errorNum, ERRORS.ERROR_DEBUG.code);
          }
          c.save({ name: "other half", text: "the brown jumps the dog", val: 3 });
          c.save({ name: "quarter", text: "quick over", val: 4 });
        }
      });

      let result = db._query(qq).toArray();
      assertEqual(result.length, 4);
      assertEqual(result[0].name, 'half');
      assertEqual(result[1].name, 'quarter');
      assertEqual(result[2].name, 'other half');
      assertEqual(result[3].name, 'full');
    },*/
  };
}


////////////////////////////////////////////////////////////////////////////////
/// @brief executes the test suite
////////////////////////////////////////////////////////////////////////////////

jsunity.run(TransactionsIResearchSuite);

return jsunity.done();

