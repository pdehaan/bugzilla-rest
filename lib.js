const fs = require("fs");

const axios = require("axios");
const LRU = require("lru-cache");
const ms = require("ms");
const qs = require("qs");
const sortJson = require("sort-json");

const BUGZILLA_HOST = process.env.BUGZILLA_HOST || "https://bugzilla.mozilla.org";

class BugzillaClient {
  constructor(host = BUGZILLA_HOST) {
    this.BUGZILLA_HOST = host;
    this._cacheFile = "./.lru-cache.json";
    this.cache = new LRU({
      max: 500,
      maxAge: ms("5 min"),
    });
    try {
      fs.statSync(this._cacheFile);
      const cacheData = fs.readFileSync(this._cacheFile, "utf-8");
      this.cache.load(JSON.parse(cacheData));
    } catch (err) {
      // CACHE FILE NOT FOUND
    }
  }

  async getProduct(name = "Firefox", params = {}) {
    const res = await this.$bugzillaClient(params, `/rest/product/${name}`);
    const { milestones, components } = res.data.products[0];
    const isActive = (arr) => arr.filter((item) => !!item.is_active);

    return sortJson({
      _url: res._url,
      milestones: isActive(milestones),
      components: isActive(components).map((component) => {
        return {
          name: component.name,
          description: component.description,
        };
      }),
    });
  }

  /**
   * Fetch bug history for a single (or multiple) bugs.
   * @param {object} params
   * @param {number|array<number>} params.ids
   * @returns {object}
   * @example await getBugHistory({ ids: [12434, 125523] })
   */
  async getBugHistory(ids = [], params = {}) {
    if (Array.isArray(ids)) {
      params.ids = ids;
    } else if (typeof ids === "string") {
      params.ids = ids.split(",");
    }
    const bug_id = params.ids[0];
    return this.$queryBugs(params, `/rest/bug/${bug_id}/history`);
  }

  /**
   * Search bugs by component, or whatever...
   * @param {object} params
   * @returns {object}
   * @example await searchBugs({ component: ["General"] })
   */
  async searchBugs(params = {}) {
    const defaultParams = {
      classification: [
        "Client Software",
        "Developer Infrastructure",
        "Components",
        "Server Software",
        "Other",
      ],
      include_fields: [
        "id",
        "summary",
        "status",
        "priority",
        "severity",
        "component",
      ].join(","),
      product: "Firefox",
      resolution: "---",
    };

    const $params = Object.assign({}, defaultParams, params);
    if (Array.isArray($params.include_fields)) {
      // Convert from an array to a comma separated list.
      $params.include_fields = $params.include_fields.join(",");
    }

    const res = await this.$queryBugs($params);
    // res.bugs = await addHistory(res.bugs);
    return res;
  }

  /**
   * Fetch one or more bugs by id.
   * @param {object} params
   * @param {string|number[]} params.id A bug id (or array of bug ids) to fetch.
   * @return {object}
   * @example await getBugById({ id: [12434, 125523] })
   */
  async getBugById(id = [], params = {}) {
    params.id = Array.isArray(id) ? id.join(",") : id;
    const res = await this.$queryBugs(params);
    // res.bugs = await addHistory(res.bugs);
    return res;
  }

  /**
   * @param {object} params
   * @param {string} apiPath
   * @returns {object}
   */
  async $queryBugs(params = {}, apiPath = "/rest/bug") {
    const res = await this.$bugzillaClient(params, apiPath);
    const bugs = sortJson(res.data.bugs).reduce(
      (map, bug) => map.set(bug.id, bug),
      new Map()
    );

    return { _url: res._url, bugs };
  }

  async $bugzillaClient(params = {}, apiPath = "") {
    const search = qs.stringify(params, { arrayFormat: "repeat" });

    const url = new URL(apiPath, this.BUGZILLA_HOST);
    url.search = search;

    if (this.cache.has(url.href)) {
      // Cache hit! Return cached value.
      return this.cache.get(url.href);
    }

    const res = await axios.get(url.href);
    
    // await axios({
    //   method: "get",
    //   url: url.href,
    //   params,
    //   paramsSerializer: (p) => qs.stringify(p, { arrayFormat: "repeat" }),
    // });

    this.cache.set(url.href, {
      _url: url.href,
      data: res.data,
    });
    // Flush cache to disk.
    fs.writeFileSync(this._cacheFile, JSON.stringify(this.cache.dump()));

    return {
      _url: res.request.res.responseUrl,
      data: res.data,
    };
  }

  async addHistory(map = new Map()) {
    const bugIds = [...map.keys()];
    const history = await this.getBugHistory(bugIds);
    for (const id of bugIds) {
      const bug = map.get(id);
      bug.history = history.bugs.get(id).history;
      map.set(id, bug);
    }
    return map;
  }
}

module.exports = {
  BugzillaClient,
  bugsByKey,
};

/**
 * @param {Map} bugMap
 * @param {string} key
 * @param {string} value
 * @return {Array} An array of bug objects.
 */
function bugsByKey(bugMap = new Map(), key = "", value = "") {
  return [...bugMap.values()].filter((v) => v[key] === value);
}
