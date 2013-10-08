(function() {
  var Backbone, bindExpression, config, decodeAttribute, encodeAttribute, escapeForRegex, escapeQuotes, expressionFunctions, getProperty, ifUnlessHelper, isExpression, liveTemplates, operators, parseExpression, replaceTemplateBlocks, stripBoundTag, templateHelpers, templateReplacers, unescapeQuotes,
    __slice = [].slice;

  Backbone = this.Backbone || typeof require === 'function' && require('backbone');

  config = {
    dontRemoveAttributes: true,
    dontStripElements: true
  };

  expressionFunctions = {};

  operators = '* / % + - << >> >>> < <= > >= == != === !== & ^ ! | && ||'.split(' ').concat(' in  ', ' instanceof ');

  isExpression = function(string) {
    return /^[a-z_\.]+$/.test(string.trim());
  };

  escapeForRegex = function(str) {
    return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&');
  };

  escapeQuotes = function(string) {
    return string.replace(/'/g, "\\'");
  };

  unescapeQuotes = function(string) {
    return string.replace(/\\'/g, "'");
  };

  encodeAttribute = function(object) {
    return escapeQuotes(JSON.stringify(object));
  };

  decodeAttribute = function(string) {
    return JSON.parse(unescapeQuotes(string || ''));
  };

  liveTemplates = function(context, config, options) {
    var $template, template;
    template = this.template || config.template;
    $template = liveTemplates.init(template, this);
    return this.$el.empty().append($template);
  };

  parseExpression = function(context, expression) {
    var dependencies, expressionIsExpression, fn, newExpressionString, regex,
      _this = this;
    regex = /[a-z\.]+/gi;
    dependencies = [];
    newExpressionString = expression.replace(regex, function(keypath) {
      if (keypath.indexOf('$window.' !== 0)) {
        dependencies.push(keypath);
      }
      return "getProperty( context, '" + keypath + "' )";
    });
    if (isExpression(expression)) {
      expressionIsExpression = true;
    }
    if (expressionIsExpression) {
      if (expressionFunctions[newExpressionString]) {
        fn = expressionFunctions[newExpressionString];
      } else {
        fn = new Function('context', 'getProperty', "return " + newExpressionString);
        expressionFunctions[newExpressionString] = fn;
      }
    }
    return {
      string: expression,
      fn: fn,
      dependencies: dependencies,
      isExpression: expressionIsExpression
    };
  };

  bindExpression = function(context, binding, callback) {
    var changeCallback, parsed;
    parsed = parseExpression(context, binding.expression);
    changeCallback = function() {
      if (binding.isExpression) {
        return callback(parsed.fn(context, getProperty));
      } else {
        return context.get(parsed.expression);
      }
    };
    if (parsed.dependencies) {
      context.on('change:' + parsed.dependencies.join(' change:'), changeCallback);
    }
    return changeCallback();
  };

  stripBoundTag = function($el) {
    var $contents, $placeholder;
    $placeholder = $(document.createTextNode('')).insertBefore($el);
    $contents = $el.contents();
    $contents.insertAfter($placeholder);
    if (!config.dontStripElements) {
      $el.remove();
    }
    return {
      $contents: $contents,
      $placeholder: $placeholder
    };
  };

  getProperty = function(context, keypath) {
    var res, value, _i, _len, _ref;
    if (keypath.indexOf('$window.') === 0) {
      _ref = keyPath.split;
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        value = _ref[_i];
        if (res) {
          res = res[value];
        }
      }
      return res;
    } else {
      try {
        return context.get(keypath);
      } catch (_error) {}
    }
  };

  templateReplacers = [
    {
      regex: /\{\{![\s|\S]*?\}\}/g,
      replace: function() {
        return '';
      }
    }, {
      regex: /<([a-z\-_]+?)[^<>]*?\{\{.+?\}\}[^<]*?>/gi,
      replace: function(context, match, tagName) {
        var attributeRe, bindings, originalMatch, replacement,
          _this = this;
        bindings = [];
        originalMatch = match;
        bindings = [];
        attributeRe = /([a-z\-_]*\s*)=\s*"([^"]*?\{\{.+?\}\}.*?)"/gi;
        replacement = match.replace(attributeRe, function(match, attrName, attrString) {
          var attrExpressionString;
          attrExpressionString = (" \"" + attrString + " \" ").replace(/(\{\{)|(\}\})/g, function(match, isOpen, isClose) {
            if (isOpen) {
              return '" + (';
            } else if (isClose) {
              return ') + "';
            } else {
              return '';
            }
          });
          return bindings.push({
            type: 'attribute',
            expression: attrExpressionString,
            attribute: attrName
          });
        });
        replacement = replacement.replace(/(\/?>)/g, " data-bind=' " + (encodeAttribute(bindings)) + "' $1");
        return replacement;
      }
    }, {
      regex: /\{\{.*?\}\}/,
      replace: function(context, match) {
        var attribute;
        attribute = encodeAttribute([
          {
            type: 'text',
            expression: match.substring(2, match.length - 2)
          }
        ]);
        return "<bind data-bind='" + attribute + "'></bind>";
      }
    }
  ];

  replaceTemplateBlocks = function(context, template) {
    var lastMatch, mustacheBlockRe, mustacheBlocks,
      _this = this;
    mustacheBlockRe = /(\{\{#[\s\S]+?\}\})([\s\S]*?)(\{\{\/[\s\S]*?\}\})/g;
    mustacheBlocks = template.match(mustacheBlockRe);
    while (mustacheBlocks && mustacheBlocks.length) {
      lastMatch = RegExp.lastMatch;
      template = template.replace(lastMatch, function() {
        var attribute, body, openTag, spaceSplit, tag;
        openTag = RegExp.$1;
        body = RegExp.$2;
        tag = openTag.substring(2, openTag.length - 2);
        spaceSplit = tag.split(" ");
        attribute = encodeAttribute([
          {
            type: spaceSplit[0].substring(1),
            expression: spaceSplit.slice(1).join(" ")
          }
        ]);
        return "<bound data-bind='" + attribute + "'>" + body + "</bound>";
      });
      mustacheBlocks = template.match(mustacheBlockRe);
    }
    return template;
  };

  ifUnlessHelper = function(context, binding, $el, inverse) {
    var $contents, $placeholder, isInserted, stripped,
      _this = this;
    stripped = stripBoundTag($el);
    $contents = stripped.$contents;
    $placeholder = stripped.$placeholder;
    isInserted = false;
    return bindExpression(context, binding, function(result) {
      if (inverse) {
        result = !result;
      }
      if (result && !isInserted) {
        $contents.insertAfter($placeholder);
        return isInserted = true;
      } else if (!result && isInserted) {
        $contents.remove();
        return isInserted = false;
      }
    });
  };

  templateHelpers = {
    each: function(context, binding, $el) {
      var $contents, $placeholder, stripped;
      stripped = stripBoundTag($el);
      $contents = stripped.$contents;
      return $placeholder = stripped.$placeholder;
    },
    attribute: function(context, binding, $el) {
      var _this = this;
      return bindExpression(context, binding, function(result) {
        return $el.attr(binding.attribute, result || '');
      });
    },
    "if": function(context, binding, $el) {
      return ifUnlessHelper.apply(null, arguments);
    },
    unless: function(context, binding, $el) {
      return ifUnlessHelper.apply(null, __slice.call(arguments).concat([true]));
    },
    text: function(context, binding, $el) {
      var _this = this;
      return bindExpression(context, binding, function(result) {
        return $el.text(result || '');
      });
    },
    outlet: function(context, binding, $el) {}
  };

  _.extend(liveTemplates, {
    init: function(template, context) {
      var bound, compiled, fragment;
      compiled = this.compileTemplate(template, context);
      fragment = this.createFragment(compiled, context);
      bound = this.bindFragment(fragment, context);
      return bound;
    },
    compileTemplate: function(template, context) {
      var replacer, _i, _len,
        _this = this;
      if (template == null) {
        template = '';
      }
      template = replaceTemplateBlocks(context, template);
      for (_i = 0, _len = templateReplacers.length; _i < _len; _i++) {
        replacer = templateReplacers[_i];
        template = template.replace(replacer.regex, function() {
          var args;
          args = 1 <= arguments.length ? __slice.call(arguments, 0) : [];
          return replacer.replace.apply(replacer, [context].concat(__slice.call(args)));
        });
      }
      return template;
    },
    createFragment: function(template, context) {
      return $("<div>").html(template);
    },
    bindFragment: function($template, context) {
      var _this = this;
      $template.find('[data-bind]').each(function(index, el) {
        var $el, binding, bindings, helper, _i, _len;
        $el = $(el);
        bindings = decodeAttribute($el.attr('data-bind'));
        for (_i = 0, _len = bindings.length; _i < _len; _i++) {
          binding = bindings[_i];
          helper = templateHelpers[binding.type];
          if (helper) {
            helper.call(context, context, binding, $el);
          } else {
            throw new Error("No helper of type " + binding.type + " found");
          }
        }
        if (!config.dontRemoveAttributes) {
          return $el.removeAttr('data-bind');
        }
      });
      return $template.contents();
    }
  });

  liveTemplates.helpers = templateHelpers;

  Backbone.extensions.view.liveTemplates = liveTemplates;

}).call(this);
