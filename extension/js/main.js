var ALIASES_KEY = "sb";

/*
    A command has the following properties

    desc - A short description
    usage - a short text to describe how to use the command
    example - using it in action
    gen - execute the function
*/



var utils = {
    format: function() {
        var newArguments = [].slice.call(arguments, 1)
        var args = newArguments;
        var s = arguments[0]
        return s.replace(/{(\d+)}/g, (match, number) => {
            return typeof args[number] != 'undefined' ? args[number] : match;
        });
    },
    redirect: function(url) {
        window.location.assign(url);
        chrome.tabs.query({
            active: true,
            currentWindow: true
        }, function(tabs) {
            chrome.tabs.update(tabs[0].id, {
                url: url
            });
        });
    }
}

var baseCommands = {
    "secs": {
        desc: "Unix timestamp conversion",
        gen: function(q) {
            if (!q) {
                return {
                    text: parseInt(new Date().getTime() / 1000, 10)
                };
            } else {
                return {
                    text: new Date(parseInt(q, 10) * 1000)
                }
            }
        }
    },
    "tr": {
        desc: "Google Translate",
        usage: "tr [[from]:[to]] text",
        example: "Example: tr ro:fr buna ziua",
        gen: function(q) {
            if (!q) {
                return {
                    text: this.example
                };
            }
            var components = q.match(/^(([a-zA-Z\-]*):([a-zA-Z\-]*)\s+)?(.*$)/);
            var from = components[2] || 'auto';
            var to = components[3] || 'en';
            var text = components[4];
            return {
                url: "https://translate.google.com/#" + from + "/" + to + "/" + text
            };
        }
    },
    "notepad" : {
        desc: "create a scratch pad",
        usage: "notepad",
        gen: function() {
            return {
                url: "data:text/html,<html contenteditable>"
            };
        }
    }
};

var coreCommands = {
    "help": {
        desc: "List available commands",
        gen: function(_unused) {
            listAll();
            return true;
        }
    },
    "alias": {
        desc: "Add or remove an alias",
        example: "alias hn https://news.ycombinator.com<br>alias foo http://{0}.{1}.com<br>",
        usage: "alias name target [target if no args]",

        gen: function(q, args) {
            var cmdName = args[0].toLowerCase();
            if (cmdName) {
                aliases = getAliases();
                if (args.length == 1) {
                    delete aliases[cmdName];
                } else {
                    aliases[cmdName] = {
                        target: args[1].match(/^[a-zA-Z_\-$]+$/) ? args[1] : undefined, // points to another command
                        url: args[1].match(/^[a-zA-Z_\-$]+$/) ? undefined : args[1],
                        urlNoArgs: args[2],
                        desc: "redirects: <i>" + args[1] +  "</i>" + (args[2] === undefined ? "" : "<br>Without args: <i>" + args[2] + "</i>"), 
                    };
                }
                setAliases(aliases)
            }
            return {
                text: "Invalid usage",
            };
        }
    },
    "rm": {
        desc: "Remove aliases",
        example: "Usage: rm cmd1 cmd2 cmd3<br>",
        gen: function(q, args) {
            aliases = getAliases();
            args.forEach(x=> delete aliases[x]);
            setAliases(aliases);
            return {
                text: "Usage: rm cmd1 cmd2 cmd3<br>"
            };
        }
    },
    "import": {
        "desc": "Import commands/aliases from a url",
        "example": "import bar foo.js",
        gen: function(q, args) {
            if (args.length != 2) {
                return {
                    "text": "Usage: import bar foo.js"
                }
            }

            var name = args[0];
            var url = args[1];
            importFromURL(name, url).then(cmd => {
                aliases = getAliases();
                aliases[name] = cmd;
                setAliases(aliases);
            }).catch(console.log)

            return {
                "text": "Imported as " + name
            }
        }
    },
    "export": {
        "desc": "Output the current aliases for sharing",
        "usage": "export",
        "gen": function(q, args) {
            return {
                "text": "<textarea class='textarea config-textarea' placeholder='Config string' rows=20>"+localStorage.getItem(ALIASES_KEY)+"</textarea>"
            }
        }
    }
};

function importFromURL(name, url) {
    return System.import(url).then(m => {
        var x = m(name, utils);
        x.genString = x.gen.toString()
        x.genSrc = true;
        return x;
    });
}

function setAliases(aliases) {
    localStorage.setItem(ALIASES_KEY, JSON.stringify(aliases));
}

function getAliases() {
    try {
        return JSON.parse(localStorage.getItem(ALIASES_KEY)) || {};
    } catch (ex) {
        return {};
    }
}

function parseArgs(s) {
    if (s.indexOf(s, '"') == -1) {
        return s.split(" ");
    }
    var spaceSeparatedList = s.split(" ");
    var res = [];
    var currWord = "";
    var currIndex = 0;
    do {
        currWord = spaceSeparatedList[currIndex];
        currIndex++;
        if (currWord[0] == '"') {
            currWord= currWord.substr(1)
            while((currWord[currWord.length-1] != '"') 
                && (currIndex < spaceSeparatedList.length)) {
                    var temp = spaceSeparatedList[currIndex];
                    currIndex++;
                    if (temp === undefined) {
                        return spaceSeparatedList;
                    }
                    currWord += ` ${temp}`
                    currWord = currWord.substring(0, currWord.length-1)
            }
        }
        res.push(currWord);
    } while (currIndex < spaceSeparatedList.length)
    return res;
}

// CommandSetLoader tries to execute the command in the command set that corresponds to the name
function CommandSetLoader(commandSet, opts) {
    return {
        gen: function(q) {
            var components = q.split(" ");
            var cmd = components[0].toLowerCase();
            var args = q.substring(components[0].length + 1);
            var params = parseArgs(args);
            var r = commandSet[cmd];
            if (r && r.target) {
                return applyLoader(
                    r.target + " " + args
                );
            }

            if (!r) {
                return false;
            }
            if ((!args || !r.url) && r.urlNoArgs) {
                return {
                    url: r.urlNoArgs
                };
            } else if (r.url) {
                params.unshift(r.url)
                return {
                    url: utils.format.apply(null, params)
                };
            } else if (r.genSrc) {
                try {
                    var x = (new Function("return " + r.genString))();
                } catch (err) {
                    return {
                        "text": "bad imported code" + err
                    }
                }
                return x.apply(null, params);
            } else if (r.gen) {
                return r.gen(args, params);
            }
            return false;
        },
        list: function() {
            var result = [];
            for (var key in commandSet) {
                result.push({
                    cmd: key,
                    cmdObject: commandSet[key],
                    style: (opts || {}).listStyle,
                });
            }
            return result;
        }
    };
}

function AliasLoader() {
    return CommandSetLoader(getAliases(), {
        listStyle: "color: red;"
    });
}

function FallbackLoader(r) {
    return {
        gen: function(q) {
            if (/%s/.test(r.url)) {
                return {
                    url: r.url.replace("%s", encodeURIComponent(q))
                }
            }
            listAll();
            return true;
        }
    };
}


var loaders = [
    AliasLoader(),
    CommandSetLoader(coreCommands, {
        listStyle: "color: navy;"
    }),
    CommandSetLoader(baseCommands),
    FallbackLoader(coreCommands["help"])
];

var loaderCalls = 0;

// try and use all the given loaders on the query text.
function applyLoader(text) {
    loaderCalls += 1;
    if (loaderCalls > 10) {
        return {
            text: "Invalid alias chain"
        };
    }
    for (var i = 0; i < loaders.length; i++) {
        var r = loaders[i].gen(text);
        if (r) {
            return r;
        }
    }
}

// navigate redirects the browser to the given url
function navigate(url) {
    window.location.assign(url);
    chrome.tabs.query({
        active: true,
        currentWindow: true
    }, function(tabs) {
        chrome.tabs.update(tabs[0].id, {
            url: url
        });
    });
}

// splitArgs parses the query from the url. It converts ?q=foo%20bar%20car into {"q":"foo bar car"}
function splitArgs(loc) {
    var hash = loc.hash.substr(1);
    hash = decodeURIComponent(hash)
    if (hash !== "") {
        return {q:hash}
    }
    var s = loc.search
    var s = decodeURIComponent(s)
    var result = {};
    var pairs = s.split(/[&?]/);
    for (var i = 0; i < pairs.length; i++) {
        if (!pairs[i]) {
            continue;
        }
        var groups = /([^=]*)(=(.*$))?/.exec(pairs[i]);
        result[groups[1]] = decodeURIComponent(groups[3].replace(/\+/g, '%20'));
    }
    return result;
}


function listAll() {
    var result = [];
    var seen = {};
    // hacks to make sure we load latest aliases
    loaders[0] = AliasLoader()
    for (var i = 0; i < loaders.length; i++) {
        if (!loaders[i].list) {
            continue;
        }
        var l = (loaders[i].list || function() {
            return [];
        })();
        for (var j = 0; j < l.length; j++) {
            if (!seen[l[j].cmd]) {
                result.push(l[j]);
                seen[l[j].cmd] = true;
            }
        }
    };

    // If updating fails because dom is not loaded, then wait for it to load.
    try {
        document.getElementById('list-all-content').innerHTML = displayEntries(result);
    } catch (e) {
        document.addEventListener("DOMContentLoaded", function(event) {
            document.getElementById('list-all-content').innerHTML = displayEntries(result);
        });
    }
}

// Writes the given content into the correct div
function displayContent(content) {
    // If updating fails because dom is not loaded, then wait for it to load.
    try {
        document.getElementById('content').innerHTML = content;
    } catch (e) {
        document.addEventListener("DOMContentLoaded", function(event) {
            document.getElementById('content').innerHTML = content;
        });
    }
}

// Entry point, bootstrap and check if requirements are met.
if (supports_html5_storage()) {
    executeCmd();
    document.addEventListener("DOMContentLoaded", function(event) {
        setUpHelp();
        setUpLoad();
        setUpAutoComplete();
    });

} else {
    document.write("This app requires Localstorage but it is not supported by your browser. Please use a newer browser.")
}

// supports_html5_storage checks if the user agent supports localStorage.
function supports_html5_storage() {
    try {
        return 'localStorage' in window && window['localStorage'] !== null;
    } catch (e) {
        return false;
    }
}


/* UI STUFF */

// setUpHelp bootstraps the help mechanism.
function setUpHelp() {
    var helpEl = document.getElementById('help')
    var currentClass = helpEl.className
    document.getElementById('helpOpen').onclick = () => {
        helpEl.className += " is-active";
    }
    helpEl.lastElementChild.onclick = () => {
        helpEl.className = currentClass;
    }
}

// setUpLoad bootstraps the load mechanism.
function setUpLoad() {
    function importStuff() {
        var x = document.getElementById('importContent').value;
        try {
            var res = JSON.parse(x)
            localStorage.setItem(ALIASES_KEY, x);
            loadEl.className = currentClass;
            displayContent("loaded")
            listAll()
        } catch (err) {
            alert("loading: " + err)
        }
    }

    var loadEl = document.getElementById('load')
    var currentClass = loadEl.className
    document.getElementById('loadOpen').onclick = () => {
            loadEl.className += " is-active";
        }
        // add handler for cancel button
    document.getElementById('submitLoadBtn').onclick = importStuff
        // add handler for cancel button
    document.getElementById('cancelLoadBtn').onclick = () => {
            loadEl.className = currentClass;
        }
        // add handler for top right cross
    loadEl.lastElementChild.onclick = () => {
        loadEl.className = currentClass;
    }
}

// displayEntries takes a result and returns a html string for representing the result in a table
function displayEntries(result, opts) {
    var opts = opts || {};
    if (opts.withSort) {

        result.sort(function(a, b) {
            if (a.cmd < b.cmd) {
                return -1;
            } else if (a.cmd > b.cmd) {
                return 1;
            } else {
                return 0;
            }
        });
    }

    var res = ""
    res += "<h2>Available commands</h2>";
    res += '<table class="table is-bordered is-striped is-narrow">';

    for (var i = 0; i < result.length; i++) {
        var styleDesc = result[i].style ? 'style="' + result[i].style + '"' : "";
        res += "<tr><td " + styleDesc + ">" + result[i].cmd + "&nbsp;</td>";
        var cmdObject = result[i].cmdObject;
        if (cmdObject.target) {
            res += "<td><i>" + cmdObject.target + "</i></td>";
        } else {
            res += "<td>" + (cmdObject.desc || "") + (cmdObject.example ? "<br>" + cmdObject.example : "") + "</td>";
        }
        res += "</tr>\n";
    }

    res += "</table><br/>";
    res += "General usage is: <tt>cmd [query]</tt>";
    return res
}


function doQuery(text) {
    var query = text;
    if (query === "") {
        var el = document.getElementById("query-text");
        query = el.value;
        el.value = "";
    }
    window.location.href='index.html#' + query; // Will not trigger refresh
    executeCmd();
}

function executeCmd() {
    displayContent(""); // clear content
    var searchQuery = splitArgs(window.location).q;
    if (searchQuery) {
        document.title = searchQuery;
        var r = applyLoader(searchQuery);
        if (r) {
            if (r.url) {
                navigate(r.url);
            } else if (r.text) {
                displayContent(r.text);
            }
        }
        listAll()
    } else {
        listAll()
    }
}

function makeList(obj) {
    var x = [];
    for (var key in obj) {
        var temp = obj[key]; // maybe clone
        temp.name = key;
        x.push(temp);
    }
    for (var i in baseCommands) {
        var temp = baseCommands[i]; // maybe clone
        temp.name = i;
        x.push(temp);

    }
    for (var i in coreCommands) {
        var temp = coreCommands[i]; // maybe clone
        temp.name = i;
        x.push(temp);
    }

    return x;
}

function doSearch(text) {
    // TODO: cache this so we don't always update
    var list = makeList(getAliases());
    var res = [];
    list.forEach(x => {
        res.push({"name":x["name"], "usage": x["usage"]||undefined})
    })
    return res;
}

function setUpAutoComplete() {
   var pv = completely(document.getElementById('container-search'));
   pv.options = [];
   pv.repaint(); 

    pv.onChange = function (text) {
        if (text.length == 0) {
            pv.options = [];
            pv.repaint();
            return; 
        }
        var oj = doSearch(text);
        pv.options =[];
        for (var i in oj) { pv.options.push(oj[i].usage || oj[i].name); }
        pv.repaint();
        pv.input.focus();
    };

    // Hacks to fix stying of the generated elements
    pv.input.className="input"
    pv.input.placeholder="Command. Try 'help'"
    pv.hint.className="input"
    pv.prompt.className="input"
    pv.wrapper.className="control has-addons"

    // Trigger search when user enters
    pv.onEnter = function(){
        doQuery(pv.input.value);
        pv.setText('');
    }

   setTimeout(function() {
    pv.input.focus();
   },0);
}