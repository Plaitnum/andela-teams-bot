import dotenv from 'dotenv';
import redis from 'redis';
import querystring from 'querystring';
import request from 'requestretry';
import { promisify } from 'util';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const client = redis.createClient(process.env.REDIS_URL);
const getAsync = promisify(client.get).bind(client);

/**
* @class Project
*/
class Project {
  /**
   * @method addUser
   * @desc This method adds a user to a Pivotal Tracker project
   *
   * @param { object } userEmail the email of the user to add
   * @param { string } projectId the ID of the project
   * @param { object } configuration the config with which to add the user
   *
   * @returns { object } a response object showing the result of the operation
   */
  async addUser(userEmail, projectId, configuration = { role: 'member' }) {
    try {
      const requestOptions = {
        baseUrl: 'https://www.pivotaltracker.com/services/v5',
        fullResponse: false,
        json: true,
        headers: {
          'Content-Type': 'application/json',
          'X-TrackerToken': process.env.PIVOTAL_TRACKER_TOKEN,
        }
      };

      var result = {}; // the result to be returned

      // add user
      requestOptions.uri = `/projects/${projectId}/memberships`;
      requestOptions.body = {
        email: userEmail,
        role: configuration.role
      };
      result = await request.post(requestOptions);

      if (result.kind !== 'project_membership') {
        throw new
        Error(`Failed to add user '${userEmail}' to Pivotal Tracker project.`);
      }

      // for uniformity with the slack API (and easy error detection)
      // add the 'ok' field
      result.ok = true;

      // result.id = addUserResponse.id;
      // result.kind = addUserResponse.kind;
      // result.person = addUserResponse.person;
      // result.project_id = addUserResponse.project_id;
      // result.role = addUserResponse.role;

      return result;
    } catch (error) {
      return {
        ok: false,
        error: error.message
      };
    }
  }
  /**
   * @method create
   * @desc This method creates a new Pivotal Tracker project
   *
   * @param { string } name the name of the project
   * @param { object } configuration the config with which to create the project
   *
   * @returns { object } a response object showing the result of the operation
   */
  async create(
    name,
    configuration = { accountId: process.env.PIVOTAL_TRACKER_ACCOUNT_ID }
  ) {
    try {
      const requestOptions = {
        baseUrl: 'https://www.pivotaltracker.com/services/v5',
        fullResponse: false,
        json: true,
        headers: {
          'Content-Type': 'application/json',
          'X-TrackerToken': process.env.PIVOTAL_TRACKER_TOKEN,
        }
      };

      var result = {}; // the result to be returned

      // create project
      requestOptions.uri = '/projects';
      requestOptions.body = {
        name,
        account_id: parseInt(configuration.accountId, 10),
        description: configuration.description,
        public: !(configuration.private),
        no_owner: true // we set this to true because we don't want to auto-add
        // the user whose token was used to make this API call
        // (we will, instead, add the currently logged in user as owner later)
      };
      result = await request.post(requestOptions);

      if (result.kind !== 'project') {
        throw new Error(`Failed to create Pivotal Tracker project '${name}'.`);
      }

      // for uniformity with the slack API (and easy error detection)
      // add the 'ok' field
      result.ok = true;
      result.url = `https://www.pivotaltracker.com/projects/${result.id}`;

      // result.created.id = createProjectResponse.id;
      // result.created.kind = createProjectResponse.kind;
      // result.created.name = createProjectResponse.name;
      // result.created.public = createProjectResponse.public;
      // result.created.project_type = createProjectResponse.project_type;
      // result.created.account_id = createProjectResponse.account_id;

      // add current user to project
      if (configuration.user) {
        result.invitedUser = await this.addUser(
          configuration.user.email,
          result.id,
          { role: 'owner' }
        );
      }

      return result;
    } catch (error) {
      return {
        ok: false,
        error: error.message
      };
    }
  }
  /**
   * @method addUser
   * @desc This method fetches stories from a Pivotal Tracker project
   *
   * @param { string } projectId the ID of the project
   * @param { object } options the options with which to fetch the stories
   *
   * @returns { object } a response object showing the result of the operation
   */
  async fetchStories(projectId, options) {
    try {
      const requestOptions = {
        baseUrl: 'https://www.pivotaltracker.com/services/v5',
        fullResponse: false,
        json: true,
        headers: {
          'Content-Type': 'application/json',
          'X-TrackerToken': process.env.PIVOTAL_TRACKER_TOKEN,
        }
      };

      let query = '';
      if (options) {
        query = querystring.stringify(options);
        if (query) {
          query = '?' + query;
        }
      }

      let result = {};
      requestOptions.uri = `/projects/${projectId}/stories${query}`;
      result = await request.get(requestOptions);

      // console.log(result);

      // for uniformity with the slack API (and easy error detection)
      // add the 'ok' field
      result.ok = true;

      return result;
    } catch (error) {
      return {
        ok: false,
        error: error.message
      };
    }
  }
  async getLabels(projectId) {
    const requestOptions = {
      baseUrl: 'https://www.pivotaltracker.com/services/v5',
      // fullResponse: false,
      json: true,
      headers: {
        'Content-Type': 'application/json',
        'X-TrackerToken': process.env.PIVOTAL_TRACKER_TOKEN,
      }
    };

    var result = {}; // the result to be returned
    requestOptions.uri = `/projects/${projectId}/labels`;
    result = await request.get(requestOptions);
    return result.body;
  }
  async getMember(userId, projectId) {
    let member = await getAsync(`${projectId}/${userId}`);
    if (member) {
      return JSON.parse(member);
    } else {
      const requestOptions = {
        baseUrl: 'https://www.pivotaltracker.com/services/v5',
        // fullResponse: false,
        json: true,
        headers: {
          'Content-Type': 'application/json',
          'X-TrackerToken': process.env.PIVOTAL_TRACKER_TOKEN,
        }
      };
  
      var result = {}; // the result to be returned
      requestOptions.uri = `/projects/${projectId}/memberships`;
      result = await request.get(requestOptions);
      const memberships = result.body;
      member = memberships.find(m => m.person.id === userId);

      // keys should expire after 24 hours
      client.set(`${projectId}/${userId}`, JSON.stringify(member), 'EX', 60 * 60 * 24);

      return member;
    }
  }
  /**
   * @method addUser
   * @desc This method removes a user from a Pivotal Tracker project
   *
   * @param { object } userEmail the email of the user to add
   * @param { string } projectId the ID of the project
   *
   * @returns { object } a response object showing the result of the operation
   */
  async removeUser(userEmail, projectId) {
    try {
      // first get all memberships
      const requestOptions = {
        baseUrl: 'https://www.pivotaltracker.com/services/v5',
        // fullResponse: false,
        json: true,
        headers: {
          'Content-Type': 'application/json',
          'X-TrackerToken': process.env.PIVOTAL_TRACKER_TOKEN,
        }
      };

      var result = {}; // the result to be returned

      requestOptions.uri = `/projects/${projectId}/memberships`;
      result = await request.get(requestOptions);
      const memberships = result.body;
      const member = memberships.find(m => m.person.email === userEmail);

      // remove user
      requestOptions.uri = `/projects/${projectId}/memberships/${member.id}`;
      result = await request.delete(requestOptions);

      // for uniformity with the slack API (and easy error detection)
      // add the 'ok' field
      result.ok = true;

      return result;
    } catch (error) {
      return {
        ok: false,
        error: error.message
      };
    }
  }
}

/**
* Pivotal Tracker Integration
* @class PivotalTracker
*/
export default class PivotalTracker {
  /**
   * @constructor
   */
  constructor() {
    this.project = new Project();
  }
}
