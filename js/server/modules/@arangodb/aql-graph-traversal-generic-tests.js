/*jshint globalstrict:true, strict:true, esnext: true */

"use strict";

////////////////////////////////////////////////////////////////////////////////
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
/// @author Tobias Gödderz
////////////////////////////////////////////////////////////////////////////////

const jsunity = require("jsunity");
const {assertEqual, assertTrue, assertFalse, assertNotEqual, assertException, assertNotNull}
  = jsunity.jsUnity.assertions;

const internal = require("internal");
const db = internal.db;
const aql = require("@arangodb").aql;
const protoGraphs = require('@arangodb/aql-graph-traversal-generic-graphs').protoGraphs;
const _ = require("lodash");


// Rose tree
class Node {
  constructor(vertex, children = []) {
    this.vertex = vertex;
    this.children = children;
  }

  // For debugging
  toObj() {
    return {[this.vertex]: this.children.map(n => n.toObj())};
  }
}


/**
 * @brief This function asserts that a list of paths is in a given DFS order
 *
 * @param tree   A rose tree (given as a Node) specifying the valid DFS
 *               orders. The root node must be the root of the DFS
 *               traversal. Each node's children correspond to the possible
 *               next vertices the DFS may visit.
 * @param paths  An array of paths to be checked.
 * @param stack  During recursion, holds the path from the root to the
 *               current vertex as an array of vertices.
 *
 * Note that the type of vertices here is irrelevant, as long as its the
 * same in the given paths and tree. E.g. paths[i][j] and, for each Node n
 * in tree, n.vertex must be of the same type (or at least comparable).
 */
const checkResIsValidDfsOf = (tree, paths, stack = []) => {
  // const debugPrint = (...args) => internal.print('> '.repeat(stack.length + 1), ...args);
  // debugPrint(`checkResIsValidDfsOf(${JSON.stringify({paths, tree: tree.toObj(), stack})})`);

  assertTrue(!_.isEmpty(paths));
  const vertex = tree.vertex;
  const curPath = _.head(paths);
  let remainingPaths = _.tail(paths);
  // push without modifying `stack`
  const curStack = stack.concat([vertex]);

  // Assert that our current position in the tree matches the current path.
  // Except for the very first call where stack === [], this should not
  // trigger, as the recursive call is only done with a correct next path.
  assertEqual(curStack, curPath);

  let remainingChildren = tree.children.slice();
  while (remainingChildren.length > 0) {
    assertFalse(remainingPaths.length === 0,
      'Not enough paths given. '
      + 'The current path/stack is ' + JSON.stringify(curStack) + '. '
      + 'Expected next would be one of: '
      + JSON.stringify(remainingChildren.map(node => curStack.concat([node.vertex])))
    );
    // Peek at the next path to check the right child next
    const nextPath = _.head(remainingPaths);
    assertNotNull(nextPath, 'No more remaining paths, but expecting one of '
      + JSON.stringify(remainingChildren.map(c => c.toObj())));
    const nextChildIndex = _.findIndex(remainingChildren, (node) =>
      _.isEqual(nextPath, curStack.concat([node.vertex]))
    );
    assertNotEqual(-1, nextChildIndex,
      `The following path is not valid at this point: ${JSON.stringify(nextPath)}
        But one of the following is expected next: ${JSON.stringify(remainingChildren.map(node => curStack.concat([node.vertex])))}
        The last asserted path is: ${JSON.stringify(curStack)}`
    );
    const [nextChild] = remainingChildren.splice(nextChildIndex, 1);

    remainingPaths = checkResIsValidDfsOf(nextChild, remainingPaths, curStack);
  }

  // When the stack is empty, we must have checked all paths by now.
  assertTrue(!_.isEmpty(stack) || _.isEmpty(remainingPaths),
    `There are unchecked paths remaining: ${JSON.stringify(remainingPaths)}`);

  return remainingPaths;
};


/**
 * @brief This function asserts that a list of paths is in BFS order and matches
 *        an expected path list.
 *
 * @param expectedPaths An array of expected paths.
 * @param actualPaths   An array of paths to be checked.
 *
 * Checks that the paths in both arrays are the same, and that the paths in
 * expectedPaths are increasing in length. Apart from that, the order of paths
 * in both arguments is ignored.
 *
 * Please note that this check does NOT work with results of {uniqueVertices: global}!
 */
const checkResIsValidBfsOf = (expectedPaths, actualPaths) => {
  assertTrue(!_.isEmpty(actualPaths));

  const pathLengths = actualPaths.map(p => p.length);
  const adjacentPairs = _.zip(pathLengths, _.tail(pathLengths));
  adjacentPairs.pop(); // we don't want the last element, because the tail is shorter
  assertTrue(adjacentPairs.every(([a, b]) => a <= b),
    `Paths are not increasing in length: ${JSON.stringify(actualPaths)}`);

  // sort paths by length first
  actualPaths = _.sortBy(actualPaths, p => [p.length, p]);
  expectedPaths = _.sortBy(expectedPaths, p => [p.length, p]);
  const missingPaths = _.difference(expectedPaths, actualPaths);
  const spuriousPaths = _.difference(actualPaths, expectedPaths);

  const messages = [];
  if (missingPaths.length > 0) {
    messages.push('The following paths are missing: ' + JSON.stringify(missingPaths));
  }
  if (spuriousPaths.length > 0) {
    messages.push('The following paths are wrong: ' + JSON.stringify(spuriousPaths));
  }

  assertEqual(expectedPaths, actualPaths, messages.join('; '));
};


/**
 * @brief This function asserts that a list of paths is in BFS order and reaches
 *        exactly the provided vertices.
 *
 * @param expectedVertices An array of expected vertices.
 * @param actualPaths      An array of paths to be checked.
 *
 * Checks that the paths are increasing in length, and each vertex is the last
 * node of exactly one of the paths.
 *
 * TODO:
 *   It does not check that the path-prefixes are matching. E.g. for a graph
 *         B       E
 *       ↗   ↘   ↗
 *     A       D
 *       ↘   ↗   ↘
 *         C       F
 *   this method would regard
 *   [[a], [a, b], [a, c], [a, c, d], [a, c, d, e], [a, b, d, f]]
 *   as valid, while the last path would have to be [a, c, d, f] with respect to
 *   the previous results.
 */
const checkResIsValidGlobalBfsOf = (expectedVertices, actualPaths) => {
  assertTrue(!_.isEmpty(actualPaths));

  const pathLengths = actualPaths.map(p => p.length);
  const adjacentPairs = _.zip(pathLengths, _.tail(pathLengths));
  adjacentPairs.pop(); // we don't want the last element, because the tail is shorter
  assertTrue(adjacentPairs.every(([a, b]) => a <= b),
    `Paths are not increasing in length: ${JSON.stringify(actualPaths)}`);

  // sort vertices before comparing
  const actualVertices = _.sortBy(actualPaths.map(p => p[p.length - 1]));
  expectedVertices = _.sortBy(expectedVertices);
  const missingVertices = _.difference(expectedVertices, actualVertices);
  const spuriousVertices = _.difference(actualVertices, expectedVertices);

  const messages = [];
  if (missingVertices.length > 0) {
    messages.push('The following vertices are missing: ' + JSON.stringify(missingVertices));
  }
  if (spuriousVertices.length > 0) {
    messages.push('The following vertices are wrong: ' + JSON.stringify(spuriousVertices));
  }

  assertEqual(expectedVertices, actualVertices, messages.join('; '));
};


/**
 * @brief Tests the function checkResIsValidDfsOf(), which is used in the tests and
 *        non-trivial. This function tests cases that should be valid.
 */
function testMetaDfsValid() {
  const expectedPathsAsTree =
    new Node("A", [
      new Node("B", [
        new Node("D", [
          new Node("E"),
          new Node("F"),
        ]),
      ]),
      new Node("C", [
        new Node("D", [
          new Node("E"),
          new Node("F"),
        ]),
      ]),
    ]);
  let paths = [
    ["A"],
    ["A", "B"],
    ["A", "B", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
    ["A", "C"],
    ["A", "C", "D"],
    ["A", "C", "D", "E"],
    ["A", "C", "D", "F"],
  ];
  checkResIsValidDfsOf(expectedPathsAsTree, paths);
  paths = [
    ["A"],
    ["A", "B"],
    ["A", "B", "D"],
    ["A", "B", "D", "F"],
    ["A", "B", "D", "E"],
    ["A", "C"],
    ["A", "C", "D"],
    ["A", "C", "D", "E"],
    ["A", "C", "D", "F"],
  ];
  checkResIsValidDfsOf(expectedPathsAsTree, paths);
  paths = [
    ["A"],
    ["A", "B"],
    ["A", "B", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
    ["A", "C"],
    ["A", "C", "D"],
    ["A", "C", "D", "F"],
    ["A", "C", "D", "E"],
  ];
  checkResIsValidDfsOf(expectedPathsAsTree, paths);
  paths = [
    ["A"],
    ["A", "B"],
    ["A", "B", "D"],
    ["A", "B", "D", "F"],
    ["A", "B", "D", "E"],
    ["A", "C"],
    ["A", "C", "D"],
    ["A", "C", "D", "F"],
    ["A", "C", "D", "E"],
  ];
  checkResIsValidDfsOf(expectedPathsAsTree, paths);
  paths = [
    ["A"],
    ["A", "C"],
    ["A", "C", "D"],
    ["A", "C", "D", "E"],
    ["A", "C", "D", "F"],
    ["A", "B"],
    ["A", "B", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
  ];
  checkResIsValidDfsOf(expectedPathsAsTree, paths);
  paths = [
    ["A"],
    ["A", "C"],
    ["A", "C", "D"],
    ["A", "C", "D", "F"],
    ["A", "C", "D", "E"],
    ["A", "B"],
    ["A", "B", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
  ];
  checkResIsValidDfsOf(expectedPathsAsTree, paths);
  paths = [
    ["A"],
    ["A", "C"],
    ["A", "C", "D"],
    ["A", "C", "D", "E"],
    ["A", "C", "D", "F"],
    ["A", "B"],
    ["A", "B", "D"],
    ["A", "B", "D", "F"],
    ["A", "B", "D", "E"],
  ];
  checkResIsValidDfsOf(expectedPathsAsTree, paths);
  paths = [
    ["A"],
    ["A", "C"],
    ["A", "C", "D"],
    ["A", "C", "D", "F"],
    ["A", "C", "D", "E"],
    ["A", "B"],
    ["A", "B", "D"],
    ["A", "B", "D", "F"],
    ["A", "B", "D", "E"],
  ];
  checkResIsValidDfsOf(expectedPathsAsTree, paths);
}


/**
 * @brief Tests the function checkResIsValidDfsOf(), which is used in the tests and
 *        non-trivial. This function tests cases that should be invalid.
 */
function testMetaDfsInvalid() {
  const expectedPathsAsTree =
    new Node("A", [
      new Node("B", [
        new Node("D", [
          new Node("E"),
          new Node("F"),
        ]),
      ]),
      new Node("C", [
        new Node("D", [
          new Node("E"),
          new Node("F"),
        ]),
      ]),
    ]);
  const validPaths = [
    ["A"],                // [0]
    ["A", "B"],           // [1]
    ["A", "B", "D"],      // [2]
    ["A", "B", "D", "E"], // [3]
    ["A", "B", "D", "F"], // [4]
    ["A", "C"],           // [5]
    ["A", "C", "D"],      // [6]
    ["A", "C", "D", "E"], // [7]
    ["A", "C", "D", "F"], // [8]
  ];
  let paths;
  // Missing paths:

  // first path missing
  paths = validPaths.slice();
  paths.splice(0, 1);
  assertException(() => checkResIsValidDfsOf(expectedPathsAsTree, paths));
  // length 3 path missing
  paths = validPaths.slice();
  paths.splice(2, 1);
  assertException(() => checkResIsValidDfsOf(expectedPathsAsTree, paths));
  // subtree missing
  paths = validPaths.slice();
  paths.splice(2, 3);
  assertException(() => checkResIsValidDfsOf(expectedPathsAsTree, paths));
  // children missing
  paths = validPaths.slice();
  paths.splice(7, 2);
  assertException(() => checkResIsValidDfsOf(expectedPathsAsTree, paths));
  // last path missing
  paths = validPaths.slice();
  paths.splice(paths.length - 1, 1);
  assertException(() => checkResIsValidDfsOf(expectedPathsAsTree, paths));

  // Superfluous paths:

  // first path duplicate
  paths = validPaths.slice();
  paths.splice(0, 0, paths[0]);
  assertException(() => checkResIsValidDfsOf(expectedPathsAsTree, paths));
  // path without children duplicate
  paths = validPaths.slice();
  paths.splice(3, 0, paths[3]);
  assertException(() => checkResIsValidDfsOf(expectedPathsAsTree, paths));
  // invalid paths added
  paths = validPaths.concat(["B"]);
  assertException(() => checkResIsValidDfsOf(expectedPathsAsTree, paths));
  paths = validPaths.concat(["A", "B", "E"]);
  assertException(() => checkResIsValidDfsOf(expectedPathsAsTree, paths));

  // Invalid orders:

  paths = validPaths.slice().reverse();
  assertException(() => checkResIsValidDfsOf(expectedPathsAsTree, paths));
  paths = validPaths.slice();
  [paths[0], paths[1]] = [paths[1], paths[0]];
  assertException(() => checkResIsValidDfsOf(expectedPathsAsTree, paths));
  paths = validPaths.slice();
  [paths[1], paths[5]] = [paths[5], paths[1]];
  assertException(() => checkResIsValidDfsOf(expectedPathsAsTree, paths));
  paths = validPaths.slice();
  [paths[4], paths[8]] = [paths[8], paths[4]];
  assertException(() => checkResIsValidDfsOf(expectedPathsAsTree, paths));

  // Paths with trailing elements:

  paths = validPaths.slice();
  paths[0] = paths[0].concat("A");
  assertException(() => checkResIsValidDfsOf(expectedPathsAsTree, paths));
  paths = validPaths.slice();
  paths[0] = paths[0].concat("B");
  assertException(() => checkResIsValidDfsOf(expectedPathsAsTree, paths));
  paths = validPaths.slice();
  paths[3] = paths[3].concat("F");
  assertException(() => checkResIsValidDfsOf(expectedPathsAsTree, paths));
  paths = validPaths.slice();
  paths[8] = paths[8].concat("F");
  assertException(() => checkResIsValidDfsOf(expectedPathsAsTree, paths));
}

function testMetaBfsValid() {
  let expectedPaths;
  let actualPaths;

  expectedPaths = [
    ["A"],
    ["A", "B"],
    ["A", "C"],
    ["A", "B", "D"],
    ["A", "C", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
    ["A", "C", "D", "E"],
    ["A", "C", "D", "F"],
  ];
  actualPaths = [
    ["A"],
    ["A", "B"],
    ["A", "C"],
    ["A", "B", "D"],
    ["A", "C", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
    ["A", "C", "D", "E"],
    ["A", "C", "D", "F"],
  ];
  checkResIsValidBfsOf(expectedPaths, actualPaths);
  actualPaths = [
    ["A"],
    ["A", "C"],
    ["A", "B"],
    ["A", "B", "D"],
    ["A", "C", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
    ["A", "C", "D", "E"],
    ["A", "C", "D", "F"],
  ];
  checkResIsValidBfsOf(expectedPaths, actualPaths);
  actualPaths = [
    ["A"],
    ["A", "C"],
    ["A", "B"],
    ["A", "C", "D"],
    ["A", "B", "D"],
    ["A", "C", "D", "E"],
    ["A", "B", "D", "F"],
    ["A", "C", "D", "F"],
    ["A", "B", "D", "E"],
  ];
  checkResIsValidBfsOf(expectedPaths, actualPaths);

  expectedPaths = [
    ["A", "B", "D"],
    ["A", "B"],
    ["A", "B", "D", "E"],
    ["A", "C"],
    ["A", "B", "D", "F"],
    ["A", "C", "D"],
    ["A", "C", "D", "E"],
    ["A"],
    ["A", "C", "D", "F"],
  ];
  actualPaths = [
    ["A"],
    ["A", "B"],
    ["A", "C"],
    ["A", "B", "D"],
    ["A", "C", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
    ["A", "C", "D", "E"],
    ["A", "C", "D", "F"],
  ];
  checkResIsValidBfsOf(expectedPaths, actualPaths);
}

function testMetaBfsInvalid() {
  let expectedPaths;
  let actualPaths;

  expectedPaths = [
    ["A"],
    ["A", "B"],
    ["A", "C"],
    ["A", "B", "D"],
    ["A", "C", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
    ["A", "C", "D", "E"],
    ["A", "C", "D", "F"],
  ];
  actualPaths = [
    ["A"],
    ["A", "B"],
    ["A", "B", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
    ["A", "C"],
    ["A", "C", "D"],
    ["A", "C", "D", "E"],
    ["A", "C", "D", "F"],
  ];
  assertException(() => checkResIsValidBfsOf(expectedPaths, actualPaths));
  expectedPaths = [
    ["A"],
    ["A", "B"],
    ["A", "B", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
    ["A", "C"],
    ["A", "C", "D"],
    ["A", "C", "D", "E"],
    ["A", "C", "D", "F"],
  ];
  actualPaths = [
    ["A"],
    ["A", "B"],
    ["A", "B", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
    ["A", "C"],
    ["A", "C", "D"],
    ["A", "C", "D", "E"],
    ["A", "C", "D", "F"],
  ];
  assertException(() => checkResIsValidBfsOf(expectedPaths, actualPaths));
  expectedPaths = [
    ["A"],
    ["A", "B"],
    ["A", "C"],
    ["A", "B", "D"],
    ["A", "C", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
    ["A", "C", "D", "E"],
    ["A", "C", "D", "F"],
  ];
  actualPaths = [
    ["A"],
    ["A", "B"],
    ["A", "C"],
    ["A", "B", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
    ["A", "C", "D"],
    ["A", "C", "D", "E"],
    ["A", "C", "D", "F"],
  ];
  assertException(() => checkResIsValidBfsOf(expectedPaths, actualPaths));
  expectedPaths = [
    ["A"],
    ["A", "B"],
    ["A", "C"],
    ["A", "B", "D"],
    ["A", "C", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
    ["A", "C", "D", "E"],
    ["A", "C", "D", "F"],
  ];
  actualPaths = [
    ["A"],
    ["A", "B"],
    ["A", "C"],
    ["A", "B", "D"],
    ["A", "C", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
    ["A", "C", "D", "E"],
  ];
  assertException(() => checkResIsValidBfsOf(expectedPaths, actualPaths));
  expectedPaths = [
    ["A"],
    ["A", "B"],
    ["A", "C"],
    ["A", "B", "D"],
    ["A", "C", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
    ["A", "C", "D", "E"],
    ["A", "C", "D", "F"],
  ];
  actualPaths = [
    ["A", "B"],
    ["A", "C"],
    ["A", "B", "D"],
    ["A", "C", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
    ["A", "C", "D", "E"],
    ["A", "C", "D", "F"],
  ];
  assertException(() => checkResIsValidBfsOf(expectedPaths, actualPaths));
  expectedPaths = [
    ["A", "B"],
    ["A", "C"],
    ["A", "B", "D"],
    ["A", "C", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
    ["A", "C", "D", "E"],
    ["A", "C", "D", "F"],
  ];
  actualPaths = [
    ["A"],
    ["A", "B"],
    ["A", "C"],
    ["A", "B", "D"],
    ["A", "C", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
    ["A", "C", "D", "E"],
    ["A", "C", "D", "F"],
  ];
  assertException(() => checkResIsValidBfsOf(expectedPaths, actualPaths));
  expectedPaths = [
    ["A"],
    ["A", "B"],
    ["A", "C"],
    ["A", "B", "D"],
    ["A", "C", "D"],
    ["A", "B", "D", "E"],
    ["A", "C", "D", "E"],
    ["A", "C", "D", "F"],
  ];
  actualPaths = [
    ["A"],
    ["A", "B"],
    ["A", "C"],
    ["A", "B", "D"],
    ["A", "C", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
    ["A", "C", "D", "E"],
    ["A", "C", "D", "F"],
  ];
  assertException(() => checkResIsValidBfsOf(expectedPaths, actualPaths));
  expectedPaths = [
    ["A"],
    ["A", "B"],
    ["A", "C"],
    ["A", "B", "D"],
    ["A", "C", "D"],
    ["A", "B", "D", "F"],
    ["A", "C", "D", "E"],
    ["A", "C", "D", "F"],
  ];
  actualPaths = [
    ["A"],
    ["A", "B"],
    ["A", "C"],
    ["A", "B", "D"],
    ["A", "C", "D"],
    ["A", "B", "D", "E"],
    ["A", "C", "D", "E"],
    ["A", "C", "D", "F"],
  ];
  assertException(() => checkResIsValidBfsOf(expectedPaths, actualPaths));
}

function testMetaBfsGlobalValid() {
  let expectedVertices;
  let actualPaths;

  expectedVertices = ["A", "B", "C", "D", "E", "F"];
  actualPaths = [
    ["A"],
    ["A", "B"],
    ["A", "C"],
    ["A", "B", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
  ];
  checkResIsValidGlobalBfsOf(expectedVertices, actualPaths);
  actualPaths = [
    ["A"],
    ["A", "C"],
    ["A", "B"],
    ["A", "B", "D"],
    ["A", "B", "D", "F"],
    ["A", "B", "D", "E"],
  ];
  checkResIsValidGlobalBfsOf(expectedVertices, actualPaths);
  actualPaths = [
    ["A"],
    ["A", "B"],
    ["A", "C"],
    ["A", "C", "D"],
    ["A", "C", "D", "E"],
    ["A", "C", "D", "F"],
  ];
  checkResIsValidGlobalBfsOf(expectedVertices, actualPaths);
  actualPaths = [
    ["A"],
    ["A", "C"],
    ["A", "B"],
    ["A", "C", "D"],
    ["A", "C", "D", "F"],
    ["A", "C", "D", "E"],
  ];
  checkResIsValidGlobalBfsOf(expectedVertices, actualPaths);

  expectedVertices = ["F", "B", "C", "E", "D", "A",];
  actualPaths = [
    ["A"],
    ["A", "C"],
    ["A", "B"],
    ["A", "B", "D"],
    ["A", "B", "D", "F"],
    ["A", "B", "D", "E"],
  ];
  checkResIsValidGlobalBfsOf(expectedVertices, actualPaths);
}

function testMetaBfsGlobalInvalid() {
  let expectedVertices;
  let actualPaths;

  expectedVertices = ["A", "B", "C", "D", "E", "F"];
  actualPaths = [
    ["A", "B"],
    ["A", "C"],
    ["A", "B", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
  ];
  assertException(() => checkResIsValidGlobalBfsOf(expectedVertices, actualPaths));

  expectedVertices = ["A", "B", "C", "D", "E", "F"];
  actualPaths = [
    ["A"],
    ["A", "B"],
    ["A", "C"],
    ["A", "B", "D"],
    ["A", "B", "D", "E"],
  ];
  assertException(() => checkResIsValidGlobalBfsOf(expectedVertices, actualPaths));

  expectedVertices = ["A", "B", "C", "D", "E", "F"];
  actualPaths = [
    ["A"],
    ["A", "B"],
    ["A", "C"],
    ["A", "B", "D"],
    ["A", "C", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
  ];
  assertException(() => checkResIsValidGlobalBfsOf(expectedVertices, actualPaths));

  expectedVertices = ["A", "B", "C", "D", "E"];
  actualPaths = [
    ["A"],
    ["A", "B"],
    ["A", "C"],
    ["A", "B", "D"],
    ["A", "C", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
  ];
  assertException(() => checkResIsValidGlobalBfsOf(expectedVertices, actualPaths));

  expectedVertices = ["B", "C", "D", "E", "F"];
  actualPaths = [
    ["A"],
    ["A", "B"],
    ["A", "C"],
    ["A", "B", "D"],
    ["A", "C", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
  ];
  assertException(() => checkResIsValidGlobalBfsOf(expectedVertices, actualPaths));

  expectedVertices = ["A", "B", "C", "D", "E", "F"];
  actualPaths = [
    ["A"],
    ["A", "B"],
    ["A", "B", "D"],
    ["A", "C"],
    ["A", "C", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
  ];
  assertException(() => checkResIsValidGlobalBfsOf(expectedVertices, actualPaths));


  expectedVertices = ["A", "B", "C", "D", "E", "F"];
  actualPaths = [
    ["A", "B"],
    ["A", "C"],
    ["A", "B", "D"],
    ["A", "C", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
    ["A"],
  ];
  assertException(() => checkResIsValidGlobalBfsOf(expectedVertices, actualPaths));


  expectedVertices = ["A", "B", "C", "D", "E", "F"];
  actualPaths = [
    ["A", "B", "D", "E"],
    ["A"],
    ["A", "B"],
    ["A", "C"],
    ["A", "B", "D"],
    ["A", "C", "D"],
    ["A", "B", "D", "F"],
  ];
  assertException(() => checkResIsValidGlobalBfsOf(expectedVertices, actualPaths));

}

function testOpenDiamondDfsUniqueVerticesPath(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.openDiamond.name()));
  const query = aql`
        FOR v, e, p IN 0..3 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} OPTIONS {uniqueVertices: "path"}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPathsAsTree =
    new Node("A", [
      new Node("B", [
        new Node("D", [
          new Node("E"),
          new Node("F"),
        ]),
      ]),
      new Node("C", [
        new Node("D", [
          new Node("E"),
          new Node("F"),
        ]),
      ]),
    ]);

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
}

function testOpenDiamondDfsUniqueVerticesNone(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.openDiamond.name()));
  const query = aql`
        FOR v, e, p IN 0..3 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} OPTIONS {uniqueVertices: "none"}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPathsAsTree =
    new Node("A", [
      new Node("B", [
        new Node("D", [
          new Node("E"),
          new Node("F"),
        ]),
      ]),
      new Node("C", [
        new Node("D", [
          new Node("E"),
          new Node("F"),
        ]),
      ]),
    ]);

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
}

function testOpenDiamondDfsUniqueEdgesPath(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.openDiamond.name()));
  const query = aql`
        FOR v, e, p IN 0..3 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} OPTIONS {uniqueEdges: "path"}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPathsAsTree =
    new Node("A", [
      new Node("B", [
        new Node("D", [
          new Node("E"),
          new Node("F"),
        ]),
      ]),
      new Node("C", [
        new Node("D", [
          new Node("E"),
          new Node("F"),
        ]),
      ]),
    ]);

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
}

function testOpenDiamondDfsUniqueEdgesNone(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.openDiamond.name()));
  const query = aql`
        FOR v, e, p IN 0..3 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} OPTIONS {uniqueEdges: "none"}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPathsAsTree =
    new Node("A", [
      new Node("B", [
        new Node("D", [
          new Node("E"),
          new Node("F"),
        ]),
      ]),
      new Node("C", [
        new Node("D", [
          new Node("E"),
          new Node("F"),
        ]),
      ]),
    ]);

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
}

function testOpenDiamondDfsUniqueEdgesUniqueVerticesPath(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.openDiamond.name()));
  const query = aql`
        FOR v, e, p IN 0..3 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} OPTIONS {uniqueEdges: "path", uniqueVertices: "path"}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPathsAsTree =
    new Node("A", [
      new Node("B", [
        new Node("D", [
          new Node("E"),
          new Node("F"),
        ]),
      ]),
      new Node("C", [
        new Node("D", [
          new Node("E"),
          new Node("F"),
        ]),
      ]),
    ]);

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
}

function testOpenDiamondDfsUniqueEdgesUniqueVerticesNone(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.openDiamond.name()));
  const query = aql`
        FOR v, e, p IN 0..3 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} OPTIONS {uniqueEdges: "none", uniqueVertices: "none"}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPathsAsTree =
    new Node("A", [
      new Node("B", [
        new Node("D", [
          new Node("E"),
          new Node("F"),
        ]),
      ]),
      new Node("C", [
        new Node("D", [
          new Node("E"),
          new Node("F"),
        ]),
      ]),
    ]);

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
}

function testOpenDiamondBfsUniqueVerticesPath(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.openDiamond.name()));
  const query = aql`
        FOR v, e, p IN 0..3 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} 
        OPTIONS {uniqueVertices: "path", bfs: true}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPaths = [
    ["A"],
    ["A", "C"],
    ["A", "B"],
    ["A", "B", "D"],
    ["A", "C", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
    ["A", "C", "D", "E"],
    ["A", "C", "D", "F"],
  ];

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidBfsOf(expectedPaths, actualPaths);
}

function testOpenDiamondBfsUniqueVerticesNone(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.openDiamond.name()));
  const query = aql`
        FOR v, e, p IN 0..3 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} 
        OPTIONS {uniqueVertices: "none", bfs: true}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPaths = [
    ["A"],
    ["A", "C"],
    ["A", "B"],
    ["A", "B", "D"],
    ["A", "C", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
    ["A", "C", "D", "E"],
    ["A", "C", "D", "F"]
  ];

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidBfsOf(expectedPaths, actualPaths);
}

function testOpenDiamondBfsUniqueVerticesGlobal(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.openDiamond.name()));
  const query = aql`
        FOR v, e, p IN 0..3 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} 
        OPTIONS {uniqueVertices: "global", bfs: true}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedVertices = ["A", "C", "B", "D", "E", "F"];

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidGlobalBfsOf(expectedVertices, actualPaths);
}

function testOpenDiamondBfsUniqueEdgesPath(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.openDiamond.name()));
  const query = aql`
        FOR v, e, p IN 0..3 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} 
        OPTIONS {uniqueEdges: "path", bfs: true}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPaths = [
    ["A"],
    ["A", "C"],
    ["A", "B"],
    ["A", "B", "D"],
    ["A", "C", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
    ["A", "C", "D", "E"],
    ["A", "C", "D", "F"]
  ];

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidBfsOf(expectedPaths, actualPaths);
}

function testOpenDiamondBfsUniqueEdgesNone(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.openDiamond.name()));
  const query = aql`
        FOR v, e, p IN 0..3 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} 
        OPTIONS {uniqueEdges: "none", bfs: true}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPaths = [
    ["A"],
    ["A", "C"],
    ["A", "B"],
    ["A", "B", "D"],
    ["A", "C", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
    ["A", "C", "D", "E"],
    ["A", "C", "D", "F"]
  ];

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidBfsOf(expectedPaths, actualPaths);
}

function testOpenDiamondBfsUniqueEdgesUniqueVerticesPath(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.openDiamond.name()));
  const query = aql`
        FOR v, e, p IN 0..3 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} 
        OPTIONS {uniqueEdges: "path", uniqueVertices: "path", bfs: true}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPaths = [
    ["A"],
    ["A", "C"],
    ["A", "B"],
    ["A", "B", "D"],
    ["A", "C", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
    ["A", "C", "D", "E"],
    ["A", "C", "D", "F"]
  ];

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidBfsOf(expectedPaths, actualPaths);
}

function testOpenDiamondBfsUniqueEdgesUniqueVerticesNone(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.openDiamond.name()));
  const query = aql`
        FOR v, e, p IN 0..3 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} 
        OPTIONS {uniqueEdges: "none", uniqueVertices: "none", bfs: true}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPaths = [
    ["A"],
    ["A", "C"],
    ["A", "B"],
    ["A", "B", "D"],
    ["A", "C", "D"],
    ["A", "B", "D", "E"],
    ["A", "B", "D", "F"],
    ["A", "C", "D", "E"],
    ["A", "C", "D", "F"]
  ];

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidBfsOf(expectedPaths, actualPaths);
}

function testOpenDiamondBfsUniqueEdgesUniquePathVerticesGlobal(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.openDiamond.name()));
  const query = aql`
        FOR v, e, p IN 0..3 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} 
        OPTIONS {uniqueEdges: "path", uniqueVertices: "global", bfs: true}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedVertices = ["A", "C", "B", "D", "E", "F"];

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidGlobalBfsOf(expectedVertices, actualPaths);
}

function testOpenDiamondBfsUniqueEdgesUniqueNoneVerticesGlobal(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.openDiamond.name()));
  const query = aql`
        FOR v, e, p IN 0..3 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} 
        OPTIONS {uniqueEdges: "none", uniqueVertices: "global", bfs: true}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedVertices = ["A", "C", "B", "D", "E", "F"];

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidGlobalBfsOf(expectedVertices, actualPaths);
}

function testSmallCircleDfsUniqueVerticesPath(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.smallCircle.name()));
  const query = aql`
        FOR v, e, p IN 0..10 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} OPTIONS {uniqueVertices: "path"}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPathsAsTree =
    new Node("A", [
      new Node("B", [
        new Node("C", [
          new Node("D")
        ])
      ])
    ]);

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
}

function testSmallCircleDfsUniqueVerticesNone(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.smallCircle.name()));
  const query = aql`
        FOR v, e, p IN 0..10 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} OPTIONS {uniqueVertices: "none"}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  // no loop expected, since uniqueEdges is path by default
  const expectedPathsAsTree =
    new Node("A", [
      new Node("B", [
        new Node("C", [
          new Node("D", [
            new Node("A")
          ])
        ])
      ])
    ]);

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
}

function testSmallCircleDfsUniqueEdgesPath(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.smallCircle.name()));
  const query = aql`
        FOR v, e, p IN 0..10 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} OPTIONS {uniqueEdges: "path"}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPathsAsTree =
    new Node("A", [
      new Node("B", [
        new Node("C", [
          new Node("D", [
            new Node("A")
          ])
        ])
      ])
    ]);

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
}

function testSmallCircleDfsUniqueEdgesNone(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.smallCircle.name()));
  const query = aql`
        FOR v, e, p IN 0..9 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} OPTIONS {uniqueEdges: "none"}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  // loop expected, since uniqueVertices is "none" by default
  const expectedPathsAsTree =
    new Node("A", [
      new Node("B", [
        new Node("C", [
          new Node("D", [
            new Node("A", [
              new Node("B", [
                new Node("C", [
                  new Node("D", [
                    new Node("A", [
                      new Node("B")
                    ])
                  ])
                ])
              ])
            ])
          ])
        ])
      ])
    ]);

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
}

function testSmallCircleDfsUniqueVerticesUniqueEdgesPath(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.smallCircle.name()));
  const query = aql`
        FOR v, e, p IN 0..10 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()}
        OPTIONS {uniqueVertices: "path", uniqueEdges: "path"}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPathsAsTree =
    new Node("A", [
      new Node("B", [
        new Node("C", [
          new Node("D")
        ])
      ])
    ]);

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
}

function testSmallCircleDfsUniqueVerticesUniqueEdgesNone(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.smallCircle.name()));
  const query = aql`
        FOR v, e, p IN 0..10 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()}
        OPTIONS {uniqueVertices: "none", uniqueEdges: "none"}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  // loop expected, since uniqueVertices is "none" by default
  const expectedPathsAsTree =
    new Node("A", [
      new Node("B", [
        new Node("C", [
          new Node("D", [
            new Node("A", [
              new Node("B", [
                new Node("C", [
                  new Node("D", [
                    new Node("A", [
                      new Node("B", [
                        new Node("C")
                      ])
                    ])
                  ])
                ])
              ])
            ])
          ])
        ])
      ])
    ]);

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
}

function testSmallCircleBfsUniqueVerticesPath(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.smallCircle.name()));
  const query = aql`
        FOR v, e, p IN 0..9 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} 
        OPTIONS {uniqueVertices: "path", bfs: true}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPaths = [
    ["A"],
    ["A", "B"],
    ["A", "B", "C"],
    ["A", "B", "C", "D"]
  ];

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidBfsOf(expectedPaths, actualPaths);
}

function testSmallCircleBfsUniqueVerticesNone(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.smallCircle.name()));
  const query = aql`
        FOR v, e, p IN 0..9 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} 
        OPTIONS {uniqueVertices: "none", bfs: true}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPaths = [
    ["A"],
    ["A", "B"],
    ["A", "B", "C"],
    ["A", "B", "C", "D"],
    ["A", "B", "C", "D", "A"]
  ];

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidBfsOf(expectedPaths, actualPaths);
}

function testSmallCircleBfsUniqueEdgesPath(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.smallCircle.name()));
  const query = aql`
        FOR v, e, p IN 0..9 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} 
        OPTIONS {uniqueEdges: "path", bfs: true}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPaths = [
    ["A"],
    ["A", "B"],
    ["A", "B", "C"],
    ["A", "B", "C", "D"],
    ["A", "B", "C", "D", "A"]
  ];

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidBfsOf(expectedPaths, actualPaths);
}

function testSmallCircleBfsUniqueEdgesNone(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.smallCircle.name()));
  const query = aql`
        FOR v, e, p IN 0..9 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} 
        OPTIONS {uniqueEdges: "none", bfs: true}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPaths = [
    ["A"],
    ["A", "B"],
    ["A", "B", "C"],
    ["A", "B", "C", "D"],
    ["A", "B", "C", "D", "A"],
    ["A", "B", "C", "D", "A", "B"],
    ["A", "B", "C", "D", "A", "B", "C"],
    ["A", "B", "C", "D", "A", "B", "C", "D"],
    ["A", "B", "C", "D", "A", "B", "C", "D", "A"],
    ["A", "B", "C", "D", "A", "B", "C", "D", "A", "B"]
  ];

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidBfsOf(expectedPaths, actualPaths);
}

function testSmallCircleBfsUniqueVerticesUniqueEdgesPath(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.smallCircle.name()));
  const query = aql`
        FOR v, e, p IN 0..9 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} 
        OPTIONS {uniqueVertices: "path", uniqueEdges: "path", bfs: true}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPaths = [
    ["A"],
    ["A", "B"],
    ["A", "B", "C"],
    ["A", "B", "C", "D"]
  ];

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidBfsOf(expectedPaths, actualPaths);
}

function testSmallCircleBfsUniqueVerticesUniqueEdgesNone(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.smallCircle.name()));
  const query = aql`
        FOR v, e, p IN 0..9 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} 
        OPTIONS {uniqueVertices: "none", uniqueEdges: "none", bfs: true}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPaths = [
    ["A"],
    ["A", "B"],
    ["A", "B", "C"],
    ["A", "B", "C", "D"],
    ["A", "B", "C", "D", "A"],
    ["A", "B", "C", "D", "A", "B"],
    ["A", "B", "C", "D", "A", "B", "C"],
    ["A", "B", "C", "D", "A", "B", "C", "D"],
    ["A", "B", "C", "D", "A", "B", "C", "D", "A"],
    ["A", "B", "C", "D", "A", "B", "C", "D", "A", "B"]
  ];

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidBfsOf(expectedPaths, actualPaths);
}

function testSmallCircleBfsUniqueEdgesPathUniqueVerticesGlobal(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.smallCircle.name()));
  const query = aql`
        FOR v, e, p IN 0..9 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} 
        OPTIONS {uniqueVertices: "global", uniqueEdges: "path", bfs: true}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedVertices = ["A", "B", "C", "D"];

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidGlobalBfsOf(expectedVertices, actualPaths);
}

function testSmallCircleBfsUniqueEdgesNoneUniqueVerticesGlobal(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.smallCircle.name()));
  const query = aql`
        FOR v, e, p IN 0..9 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} 
        OPTIONS {uniqueVertices: "global", uniqueEdges: "none", bfs: true}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedVertices = ["A", "B", "C", "D"];

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidGlobalBfsOf(expectedVertices, actualPaths);
}

function testCompleteGraphDfsUniqueVerticesPathD1(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.completeGraph.name()));
  const query = aql`
        FOR v, e, p IN 0..1 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} OPTIONS {uniqueVertices: "path"}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPathsAsTree =
    new Node("A", [
      new Node("B"),
      new Node("C"),
      new Node("D"),
      new Node("E"),
    ])
  ;

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
}

function testCompleteGraphDfsUniqueEdgesPathD1(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.completeGraph.name()));
  const query = aql`
        FOR v, e, p IN 0..1 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} OPTIONS {uniqueEdges: "path"}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPathsAsTree =
    new Node("A", [
      new Node("B"),
      new Node("C"),
      new Node("D"),
      new Node("E"),
    ])
  ;

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
}


function testCompleteGraphDfsUniqueVerticesPathD2(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.completeGraph.name()));
  const query = aql`
        FOR v, e, p IN 0..2 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} OPTIONS {uniqueVertices: "path"}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPathsAsTree =
    new Node("A", [
      new Node("B", [
        new Node("C"),
        new Node("D"),
        new Node("E"),
      ]),
      new Node("C", [
        new Node("B"),
        new Node("D"),
        new Node("E"),
      ]),
      new Node("D", [
        new Node("B"),
        new Node("C"),
        new Node("E"),
      ]),
      new Node("E", [
        new Node("B"),
        new Node("C"),
        new Node("D"),
      ])
    ])
  ;

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
}

function testCompleteGraphDfsUniqueEdgesPathD2(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.completeGraph.name()));
  const query = aql`
        FOR v, e, p IN 0..2 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} OPTIONS {uniqueEdges: "path"}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPathsAsTree =
    new Node("A", [
      new Node("B", [
        new Node("A"),
        new Node("C"),
        new Node("D"),
        new Node("E"),
      ]),
      new Node("C", [
        new Node("A"),
        new Node("B"),
        new Node("D"),
        new Node("E"),
      ]),
      new Node("D", [
        new Node("A"),
        new Node("B"),
        new Node("C"),
        new Node("E"),
      ]),
      new Node("E", [
        new Node("A"),
        new Node("B"),
        new Node("C"),
        new Node("D"),
      ])
    ])
  ;

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
}

function testCompleteGraphDfsUniqueVerticesPathD3(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.completeGraph.name()));
  const query = aql`
        FOR v, e, p IN 0..3 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} OPTIONS {uniqueVertices: "path"}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPathsAsTree =
    new Node("A", [
      new Node("B", [
        new Node("C", [
          new Node("D"),
          new Node("E")
        ]),
        new Node("D", [
          new Node("C"),
          new Node("E")
        ]),
        new Node("E", [
          new Node("C"),
          new Node("D")
        ])
      ]),
      new Node("C", [
        new Node("B", [
          new Node("D"),
          new Node("E")
        ]),
        new Node("D", [
          new Node("B"),
          new Node("E")
        ]),
        new Node("E", [
          new Node("B"),
          new Node("D")
        ])
      ]),
      new Node("D", [
        new Node("B", [
          new Node("C"),
          new Node("E")
        ]),
        new Node("C", [
          new Node("E"),
          new Node("B")
        ]),
        new Node("E", [
          new Node("C"),
          new Node("B")
        ])
      ]),
      new Node("E", [
        new Node("B", [
          new Node("C"),
          new Node("D")
        ]),
        new Node("C", [
          new Node("B"),
          new Node("D")
        ]),
        new Node("D", [
          new Node("C"),
          new Node("B")
        ])
      ])
    ])
  ;

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
}

function testCompleteGraphDfsUniqueVerticesUniqueEdgesNoneD2(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.completeGraph.name()));
  const query = aql`
        FOR v, e, p IN 0..2 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} OPTIONS {uniqueVertices: "none", uniqueEdges: "none"}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPathsAsTree =
    new Node("A", [
      new Node("B", [
        new Node("A"),
        new Node("C"),
        new Node("D"),
        new Node("E"),
      ]),
      new Node("C", [
        new Node("A"),
        new Node("B"),
        new Node("D"),
        new Node("E"),
      ]),
      new Node("D", [
        new Node("A"),
        new Node("B"),
        new Node("C"),
        new Node("E"),
      ]),
      new Node("E", [
        new Node("A"),
        new Node("B"),
        new Node("C"),
        new Node("D"),
      ])
    ])
  ;

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
}

function getExpectedBinTree() {
  const leftChild = vi => 2 * vi + 1;
  const rightChild = vi => 2 * vi + 2;
  const buildBinTree = (vi, depth) => new Node(`v${vi}`,
    depth === 0 ? []
      : [buildBinTree(leftChild(vi), depth - 1),
        buildBinTree(rightChild(vi), depth - 1)]);
  if (typeof getExpectedBinTree.expectedBinTree === 'undefined') {
    // build tree only once
    getExpectedBinTree.expectedBinTree = buildBinTree(0, 8);
  }
  return getExpectedBinTree.expectedBinTree;
}

function treeToPaths(tree, stack = []) {
  const curStack = stack.concat([tree.vertex]);
  return [curStack].concat(...tree.children.map(node => treeToPaths(node, curStack)));
}

function getExpectedBinTreePaths() {
  if (typeof getExpectedBinTreePaths.expectedPaths === 'undefined') {
    // build paths only once
    getExpectedBinTreePaths.expectedPaths = treeToPaths(getExpectedBinTree());
  }
  return getExpectedBinTreePaths.expectedPaths;
}

function testLargeBinTree(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.largeBinTree.name()));
  const expectedPathsAsTree = getExpectedBinTree();
  const expectedPaths = getExpectedBinTreePaths();

  const optionsList = [
    {bfs: false, uniqueEdges: "none", uniqueVertices: "none"},
    {bfs: false, uniqueEdges: "path", uniqueVertices: "none"},
    {bfs: false, uniqueEdges: "none", uniqueVertices: "path"},
    {bfs: false, uniqueEdges: "path", uniqueVertices: "path"}, // same as above
    {bfs: true, uniqueEdges: "none", uniqueVertices: "none"},
    {bfs: true, uniqueEdges: "path", uniqueVertices: "none"},
    {bfs: true, uniqueEdges: "none", uniqueVertices: "path"},
    {bfs: true, uniqueEdges: "path", uniqueVertices: "path"}, // same as above
    {bfs: true, uniqueEdges: "none", uniqueVertices: "global"},
    {bfs: true, uniqueEdges: "path", uniqueVertices: "global"}, // same as above
  ];

  for (const options of optionsList) {
    const query = `
      FOR v, e, p IN 0..10 OUTBOUND @start GRAPH @graph OPTIONS ${JSON.stringify(options)}
      RETURN p.vertices[* RETURN CURRENT.key]
    `;
    const res = db._query(query, {start: testGraph.vertex('v0'), graph: testGraph.name()});
    const actualPaths = res.toArray();

    try {
      if (options.bfs) {
        checkResIsValidBfsOf(expectedPaths, actualPaths);
      } else {
        checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
      }
    } catch (e) {
      // Note that we cannot prepend our message, otherwise the assertion
      if (e.hasOwnProperty('message')) {
        e.message = `${e.message}\nwhile trying the following options: ${JSON.stringify(options)}`;
        throw e;
      } else if (typeof e === 'string') {
        throw `${e}\nwhile trying the following options: ${JSON.stringify(options)}`;
      }
      throw e;
    }
  }
}

function testMetaTreeToPaths() {
  let paths;
  let tree;

  paths = [["a"]];
  tree = new Node("a");
  assertEqual(_.sortBy(paths), _.sortBy(treeToPaths(tree)));

  paths = [["a"], ["a", "b"], ["a", "b", "c"]];
  tree = new Node("a", [new Node("b", [new Node("c")])]);
  assertEqual(_.sortBy(paths), _.sortBy(treeToPaths(tree)));

  paths = [["a"], ["a", "b"], ["a", "c"]];
  tree = new Node("a", [new Node("b"), new Node("c")]);
  assertEqual(_.sortBy(paths), _.sortBy(treeToPaths(tree)));

  paths = [
    ["a"], ["a", "b"], ["a", "c"], ["a", "c", "d"], ["a", "b", "d"],
    ["a", "b", "d", "e"], ["a", "b", "d", "f"],
    ["a", "c", "d", "e"], ["a", "c", "d", "f"],
  ];
  tree =
    new Node("a", [
      new Node("b", [
        new Node("d", [
          new Node("e"),
          new Node("f"),
        ]),
      ]),
      new Node("c", [
        new Node("d", [
          new Node("e"),
          new Node("f"),
        ]),
      ]),
    ]);
  assertEqual(_.sortBy(paths), _.sortBy(treeToPaths(tree)));
}

function testEasyPathDfsUniqueVerticesPath(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.easyPath.name()));
  const query = aql`
        FOR v, e, p IN 0..10 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} OPTIONS {uniqueVertices: "path"}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPathsAsTree =
    new Node("A", [
      new Node("B", [
        new Node("C", [
          new Node("D", [
            new Node("E", [
              new Node("F", [
                new Node("G", [
                  new Node("H", [
                    new Node("I", [
                      new Node("J", [])
                    ])
                  ])
                ])
              ])
            ])
          ])
        ])
      ])
    ]);

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
}

function testEasyPathDfsUniqueVerticesNone(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.easyPath.name()));
  const query = aql`
        FOR v, e, p IN 0..10 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} OPTIONS {uniqueVertices: "none"}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPathsAsTree =
    new Node("A", [
      new Node("B", [
        new Node("C", [
          new Node("D", [
            new Node("E", [
              new Node("F", [
                new Node("G", [
                  new Node("H", [
                    new Node("I", [
                      new Node("J", [])
                    ])
                  ])
                ])
              ])
            ])
          ])
        ])
      ])
    ]);

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
}

function testEasyPathDfsUniqueEdgesPath(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.easyPath.name()));
  const query = aql`
        FOR v, e, p IN 0..10 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} OPTIONS {uniqueEdges: "path"}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPathsAsTree =
    new Node("A", [
      new Node("B", [
        new Node("C", [
          new Node("D", [
            new Node("E", [
              new Node("F", [
                new Node("G", [
                  new Node("H", [
                    new Node("I", [
                      new Node("J", [])
                    ])
                  ])
                ])
              ])
            ])
          ])
        ])
      ])
    ]);

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
}

function testEasyPathDfsUniqueEdgesNone(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.easyPath.name()));
  const query = aql`
        FOR v, e, p IN 0..10 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} OPTIONS {uniqueEdges: "none"}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPathsAsTree =
    new Node("A", [
      new Node("B", [
        new Node("C", [
          new Node("D", [
            new Node("E", [
              new Node("F", [
                new Node("G", [
                  new Node("H", [
                    new Node("I", [
                      new Node("J", [])
                    ])
                  ])
                ])
              ])
            ])
          ])
        ])
      ])
    ]);

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
}

function testEasyPathDfsUniqueEdgesUniqueVerticesPath(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.easyPath.name()));
  const query = aql`
        FOR v, e, p IN 0..10 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} OPTIONS {uniqueEdges: "path", uniqueVertices: "path"}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPathsAsTree =
    new Node("A", [
      new Node("B", [
        new Node("C", [
          new Node("D", [
            new Node("E", [
              new Node("F", [
                new Node("G", [
                  new Node("H", [
                    new Node("I", [
                      new Node("J", [])
                    ])
                  ])
                ])
              ])
            ])
          ])
        ])
      ])
    ]);

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
}

function testEasyPathDfsUniqueEdgesUniqueVerticesNone(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.easyPath.name()));
  const query = aql`
        FOR v, e, p IN 0..10 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} OPTIONS {uniqueEdges: "none", uniqueVertices: "none"}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPathsAsTree =
    new Node("A", [
      new Node("B", [
        new Node("C", [
          new Node("D", [
            new Node("E", [
              new Node("F", [
                new Node("G", [
                  new Node("H", [
                    new Node("I", [
                      new Node("J", [])
                    ])
                  ])
                ])
              ])
            ])
          ])
        ])
      ])
    ]);

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
}

function testAdvancedPathDfsUniqueVerticesPath(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.advancedPath.name()));
  const query = aql`
        FOR v, e, p IN 0..10 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} OPTIONS {uniqueVertices: "path"}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPathsAsTree =
    new Node("A", [
      new Node("B", [
        new Node("C", [
          new Node("D", [
            new Node("E", [
              new Node("F", [
                new Node("G", [
                  new Node("H", [
                    new Node("I", [
                    ])
                  ])
                ])
              ]),
              new Node("H", [
                new Node("I")
              ])
            ])
          ])
        ])
      ]),
      new Node("D", [
        new Node("E", [
          new Node("F", [
            new Node("G", [
              new Node("H", [
                new Node("I", [
                ])
              ])
            ])
          ]),
          new Node("H", [
            new Node("I")
          ])
        ])
      ]),
    ]);

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
}

function testAdvancedPathDfsUniqueVerticesNone(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.advancedPath.name()));
  const query = aql`
        FOR v, e, p IN 0..10 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} OPTIONS {uniqueVertices: "none"}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPathsAsTree =
    new Node("A", [
      new Node("B", [
        new Node("C", [
          new Node("D", [
            new Node("E", [
              new Node("F", [
                new Node("G", [
                  new Node("H", [
                    new Node("I")
                  ])
                ])
              ])
            ])
          ])
        ])
      ]),
      new Node("D", [
        new Node("E", [
          new Node("H", [
            new Node("I")
          ]),
          new Node("F", [
            new Node("G", [
              new Node("H", [
                new Node("I")
              ])
            ])
          ])
        ])
      ])
    ]);

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
}

function testAdvancedPathDfsUniqueEdgesPath(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.advancedPath.name()));
  const query = aql`
        FOR v, e, p IN 0..10 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} OPTIONS {uniqueEdges: "path"}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPathsAsTree =
    new Node("A", [
      new Node("B", [
        new Node("C", [
          new Node("D", [
            new Node("E", [
              new Node("F", [
                new Node("G", [
                  new Node("H", [
                    new Node("I", [
                      new Node("J", [])
                    ])
                  ])
                ])
              ])
            ])
          ])
        ])
      ])
    ]);

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
}

function testAdvancedPathDfsUniqueEdgesNone(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.advancedPath.name()));
  const query = aql`
        FOR v, e, p IN 0..10 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} OPTIONS {uniqueEdges: "none"}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPathsAsTree =
    new Node("A", [
      new Node("B", [
        new Node("C", [
          new Node("D", [
            new Node("E", [
              new Node("F", [
                new Node("G", [
                  new Node("H", [
                    new Node("I", [
                      new Node("J", [])
                    ])
                  ])
                ])
              ])
            ])
          ])
        ])
      ])
    ]);

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
}

function testAdvancedPathDfsUniqueEdgesUniqueVerticesPath(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.advancedPath.name()));
  const query = aql`
        FOR v, e, p IN 0..10 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} OPTIONS {uniqueEdges: "path", uniqueVertices: "path"}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPathsAsTree =
    new Node("A", [
      new Node("B", [
        new Node("C", [
          new Node("D", [
            new Node("E", [
              new Node("F", [
                new Node("G", [
                  new Node("H", [
                    new Node("I", [
                      new Node("J", [])
                    ])
                  ])
                ])
              ])
            ])
          ])
        ])
      ])
    ]);

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
}

function testAdvancedPathDfsUniqueEdgesUniqueVerticesNone(testGraph) {
  assertTrue(testGraph.name().startsWith(protoGraphs.advancedPath.name()));
  const query = aql`
        FOR v, e, p IN 0..10 OUTBOUND ${testGraph.vertex('A')} GRAPH ${testGraph.name()} OPTIONS {uniqueEdges: "none", uniqueVertices: "none"}
        RETURN p.vertices[* RETURN CURRENT.key]
      `;

  const expectedPathsAsTree =
    new Node("A", [
      new Node("B", [
        new Node("C", [
          new Node("D", [
            new Node("E", [
              new Node("F", [
                new Node("G", [
                  new Node("H", [
                    new Node("I", [
                      new Node("J", [])
                    ])
                  ])
                ])
              ])
            ])
          ])
        ])
      ])
    ]);

  const res = db._query(query);
  const actualPaths = res.toArray();

  checkResIsValidDfsOf(expectedPathsAsTree, actualPaths);
}

/*
  Tests to write:
    - different graphs
    - with different smart attribute / sharding combinations
    - with community graph
    - different uniqueness levels
    - different traversal directions (INBOUND, OUTBOUND, ANY)
    - dfs, bfs
 */

const testsByGraph = {
  openDiamond: {
    testOpenDiamondDfsUniqueVerticesPath,
    testOpenDiamondDfsUniqueVerticesNone,
    testOpenDiamondDfsUniqueEdgesPath,
    testOpenDiamondDfsUniqueEdgesNone,
    testOpenDiamondDfsUniqueEdgesUniqueVerticesPath,
    testOpenDiamondDfsUniqueEdgesUniqueVerticesNone,
    testOpenDiamondBfsUniqueVerticesPath,
    testOpenDiamondBfsUniqueVerticesNone,
    testOpenDiamondBfsUniqueVerticesGlobal,
    testOpenDiamondBfsUniqueEdgesPath,
    testOpenDiamondBfsUniqueEdgesNone,
    testOpenDiamondBfsUniqueEdgesUniqueVerticesPath,
    testOpenDiamondBfsUniqueEdgesUniqueVerticesNone,
    testOpenDiamondBfsUniqueEdgesUniquePathVerticesGlobal,
    testOpenDiamondBfsUniqueEdgesUniqueNoneVerticesGlobal
  },
  smallCircle: {
    testSmallCircleDfsUniqueVerticesPath,
    testSmallCircleDfsUniqueVerticesNone,
    testSmallCircleDfsUniqueEdgesPath,
    testSmallCircleDfsUniqueEdgesNone,
    testSmallCircleDfsUniqueVerticesUniqueEdgesPath,
    testSmallCircleDfsUniqueVerticesUniqueEdgesNone,
    testSmallCircleBfsUniqueVerticesPath,
    testSmallCircleBfsUniqueVerticesNone,
    testSmallCircleBfsUniqueEdgesPath,
    testSmallCircleBfsUniqueEdgesNone,
    testSmallCircleBfsUniqueVerticesUniqueEdgesPath,
    testSmallCircleBfsUniqueVerticesUniqueEdgesNone,
    testSmallCircleBfsUniqueEdgesPathUniqueVerticesGlobal,
    testSmallCircleBfsUniqueEdgesNoneUniqueVerticesGlobal
  },
  completeGraph: {
    testCompleteGraphDfsUniqueVerticesPathD1,
    testCompleteGraphDfsUniqueVerticesPathD2,
    testCompleteGraphDfsUniqueVerticesPathD3,
    testCompleteGraphDfsUniqueEdgesPathD1,
    testCompleteGraphDfsUniqueEdgesPathD2,
    //testCompleteGraphDfsUniqueEdgesPathD3,
    testCompleteGraphDfsUniqueVerticesUniqueEdgesNoneD2
  },
  easyPath: {
    testEasyPathDfsUniqueVerticesPath,
    testEasyPathDfsUniqueVerticesNone,
    testEasyPathDfsUniqueEdgesPath,
    testEasyPathDfsUniqueEdgesNone,
    testEasyPathDfsUniqueEdgesUniqueVerticesPath,
    testEasyPathDfsUniqueEdgesUniqueVerticesNone
  },
  advancedPath: {
    testAdvancedPathDfsUniqueVerticesPath,
    //testAdvancedPathDfsUniqueVerticesNone,
    //testAdvancedPathDfsUniqueEdgesPath,
    //testAdvancedPathDfsUniqueEdgesNone,
    //testAdvancedPathDfsUniqueEdgesUniqueVerticesPath,
    //testAdvancedPathDfsUniqueEdgesUniqueVerticesNone
  },
  largeBinTree: {
    testLargeBinTree,
  }
};

const metaTests = {
  testMetaDfsValid,
  testMetaDfsInvalid,
  testMetaBfsValid,
  testMetaBfsInvalid,
  testMetaBfsGlobalValid,
  testMetaBfsGlobalInvalid,
  testMetaTreeToPaths,
};

exports.testsByGraph = testsByGraph;
exports.metaTests = metaTests;
