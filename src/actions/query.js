import { forEach } from 'lodash'
import { actionTypes } from '../constants'
import { promisesForPopulate } from '../utils/populate'
import {
  applyParamsToQuery,
  getWatcherCount,
  orderedFromSnapshot,
  setWatcher,
  unsetWatcher,
  getQueryIdFromPath
} from '../utils/query'

const { START, SET, UNAUTHORIZED_ERROR } = actionTypes

/**
 * @description Watch a path in Firebase Real Time Database
 * @param {Object} firebase - Internal firebase object
 * @param {Function} dispatch - Action dispatch function
 * @param {Object} options - Event options object
 * @param {String} options.event - Type of event to watch for (defaults to value)
 * @param {String} options.path - Path to watch with watcher
 * @param {Array} options.queryParams - List of query parameters
 * @param {String} options.storeAs - Location within redux to store value
 */
export const watchEvent = (firebase, dispatch, options) => {
  let { queryId } = options
  const {
    type,
    path,
    populates,
    queryParams,
    isQuery,
    storeAs
  } = options
  const watchPath = !storeAs ? path : `${path}@${storeAs}`
  const counter = getWatcherCount(firebase, type, watchPath, queryId)
  queryId = queryId || getQueryIdFromPath(path, type)

  if (counter > 0) {
    if (queryId) {
      unsetWatcher(firebase, dispatch, type, path, queryId)
    } else {
      return
    }
  }

  setWatcher(firebase, type, watchPath, queryId)

  if (type === 'first_child') {
    return firebase.database()
      .ref()
      .child(path)
      .orderByKey()
      .limitToFirst(1)
      .once('value', snapshot => {
        if (snapshot.val() === null) {
          dispatch({
            type: actionTypes.NO_VALUE,
            timestamp: Date.now(),
            requesting: false,
            requested: true,
            path: storeAs || path
          })
        }
        return snapshot
      })
      .catch(err => {
        // TODO: Handle catching unauthorized error
        // dispatch({
        //   type: UNAUTHORIZED_ERROR,
        //   payload: err
        // })
        dispatch({
          type: actionTypes.ERROR,
          payload: err
        })
        return Promise.reject(err)
      })
  }

  let query = firebase.database().ref().child(path)

  if (isQuery) {
    query = applyParamsToQuery(queryParams, query)
  }

  const runQuery = (q, e, p, params) => {
    dispatch({
      type: START,
      timestamp: Date.now(),
      requesting: true,
      requested: false,
      path: storeAs || path
    })

    // Handle once queries (Promise)
    if (e === 'once') {
      return q.once('value')
        .then(snapshot => {
          dispatch({
            type: SET,
            path: storeAs || path,
            data: snapshot.val(),
            ordered: orderedFromSnapshot(snapshot)
          })
          return snapshot
        })
        .catch(err => {
          dispatch({
            type: actionTypes.ERROR,
            payload: err
          })
          return Promise.reject(err)
        })
    }

    // Handle all other queries (listener)
    /* istanbul ignore next: is run by tests but doesn't show in coverage */
    q.on(e, snapshot => {
      let data = (e === 'child_removed') ? undefined : snapshot.val()
      const resultPath = storeAs || (e === 'value') ? p : `${p}/${snapshot.key}`
      const ordered = orderedFromSnapshot(snapshot, e)

      // Dispatch standard event if no populates exists
      if (!populates) {
        return dispatch({
          type: SET,
          path: storeAs || resultPath,
          ordered,
          data,
          timestamp: Date.now(),
          requesting: false,
          requested: true
        })
      }

      // TODO: Allow setting of unpopulated data before starting population through config
      // TODO: Set ordered for populate queries
      // TODO: Allow config to toggle Combining into one SET action
      const dataKey = snapshot.key
      promisesForPopulate(firebase, dataKey, data, populates)
        .then((results) => {
          // dispatch child sets first so isLoaded is only set to true for
          // populatedDataToJS after all data is in redux (Issue #121)
          forEach(results, (result, path) => {
            dispatch({
              type: SET,
              path,
              data: result,
              timestamp: Date.now(),
              requesting: false,
              requested: true
            })
          })
          dispatch({
            type: SET,
            path: storeAs || resultPath,
            ordered,
            data,
            timestamp: Date.now(),
            requesting: false,
            requested: true
          })
        })
    }, (err) => {
      dispatch({
        type: UNAUTHORIZED_ERROR,
        payload: err
      })
    })
  }

  return runQuery(query, type, path, queryParams)
}

/**
 * @description Remove watcher from an event
 * @param {Object} firebase - Internal firebase object
 * @param {Function} dispatch - Action dispatch function
 * @param {Object} config - Config object
 * @param {String} config.type - Type for which to remove the watcher (
 * value, once, first_child etc.)
 * @param {String} config.path - Path of watcher to remove
 * @param {String} config.storeAs - Path which to store results within in
 * redux store
 * @param {String} config.queryId - Id of the query (used for idendifying)
 * in internal watchers list
 */
export const unWatchEvent = (firebase, dispatch, { type, path, storeAs, queryId }) => {
  const watchPath = !storeAs ? path : `${path}@${storeAs}`
  unsetWatcher(firebase, dispatch, type, watchPath, queryId)
}

/**
 * @description Add watchers to a list of events
 * @param {Object} firebase - Internal firebase object
 * @param {Function} dispatch - Action dispatch function
 * @param {Array} events - List of events for which to add watchers
 */
export const watchEvents = (firebase, dispatch, events) =>
  events.forEach(event =>
    watchEvent(firebase, dispatch, event)
  )

/**
 * @description Remove watchers from a list of events
 * @param {Object} firebase - Internal firebase object
 * @param {Array} events - List of events for which to remove watchers
 */
export const unWatchEvents = (firebase, dispatch, events) =>
  events.forEach(event =>
    unWatchEvent(firebase, dispatch, event)
  )

export default { watchEvents, unWatchEvents }
