/**
 * @fileoverview Warns about `-` prefixed classnames using arbitrary values
 * @author François Massart
 */
'use strict';

const docsUrl = require('../util/docsUrl');
const customConfig = require('../util/customConfig');
const astUtil = require('../util/ast');
const attrUtil = require('../util/attr');
const groupUtil = require('../util/groupMethods');
const getOption = require('../util/settings');
const parserUtil = require('../util/parser');

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

// Predefine message for use in context.report conditional.
// messageId will still be usable in tests.
const NEGATIVE_ARBITRARY_VALUE = `Arbitrary value classname '{{classname}}' should not start with a dash (-)`;

module.exports = {
  meta: {
    docs: {
      description: 'Warns about dash prefixed classnames using arbitrary values',
      category: 'Best Practices',
      recommended: true,
      url: docsUrl('enforces-negative-arbitrary-values'),
    },
    messages: {
      negativeArbitraryValue: NEGATIVE_ARBITRARY_VALUE,
    },
    fixable: null,
    schema: [
      {
        type: 'object',
        properties: {
          callees: {
            type: 'array',
            items: { type: 'string', minLength: 0 },
            uniqueItems: true,
          },
          config: {
            default: 'tailwind.config.js',
            type: ['string', 'object'],
          },
          tags: {
            type: 'array',
            items: { type: 'string', minLength: 0 },
            uniqueItems: true,
          },
        },
      },
    ],
  },

  create: function (context) {
    const callees = getOption(context, 'callees');
    const tags = getOption(context, 'tags');
    const twConfig = getOption(context, 'config');

    const mergedConfig = customConfig.resolve(twConfig);

    //----------------------------------------------------------------------
    // Helpers
    //----------------------------------------------------------------------

    /**
     * Recursive function crawling into child nodes
     * @param {ASTNode} node The root node of the current parsing
     * @param {ASTNode} arg The child node of node
     * @returns {void}
     */
    const parseForNegativeArbitraryClassNames = (node, arg = null) => {
      let originalClassNamesValue = null;
      let trim = false;
      if (arg === null) {
        originalClassNamesValue = astUtil.extractValueFromNode(node);
      } else {
        switch (arg.type) {
          case 'TemplateLiteral':
            arg.expressions.forEach((exp) => {
              parseForNegativeArbitraryClassNames(node, exp);
            });
            arg.quasis.forEach((quasis) => {
              parseForNegativeArbitraryClassNames(node, quasis);
            });
            return;
          case 'ConditionalExpression':
            parseForNegativeArbitraryClassNames(node, arg.consequent);
            parseForNegativeArbitraryClassNames(node, arg.alternate);
            return;
          case 'LogicalExpression':
            parseForNegativeArbitraryClassNames(node, arg.right);
            return;
          case 'ArrayExpression':
            arg.elements.forEach((el) => {
              parseForNegativeArbitraryClassNames(node, el);
            });
            return;
          case 'ObjectExpression':
            arg.properties.forEach((prop) => {
              switch (prop.type) {
                case 'SpreadElement':
                  parseForNegativeArbitraryClassNames(node, prop.argument);
                  break;
                case 'Property':
                default:
                  parseForNegativeArbitraryClassNames(node, prop.key);
                  break;
              }
            });
            return;
          case 'Literal':
            trim = true;
            originalClassNamesValue = arg.value;
            break;
          case 'TemplateElement':
            originalClassNamesValue = arg.value.raw;
            // https://github.com/eslint/eslint/issues/13360
            // The problem is that range computation includes the backticks (`test`)
            // but value.raw does not include them, so there is a mismatch.
            // start/end does not include the backticks, therefore it matches value.raw.
            const txt = context.getSourceCode().getText(arg);
            break;
        }
      }

      let classNames = attrUtil.getClassNamesFromAttribute(originalClassNamesValue, trim);

      const detected = classNames.filter((cls) => {
        const suffix = groupUtil.getSuffix(cls, mergedConfig.separator);
        const negArbitraryValRegEx =
          /^\-((inset|scale)(\-(y|x))?|top|right|bottom|left|top|z|order|(scroll\-)?m(y|x|t|r|l|b)?|(skew|space|translate)\-(y|x)|rotate|tracking|indent|(backdrop\-)?hue\-rotate)\-\[.*\]$/i;
        return negArbitraryValRegEx.test(suffix);
      });

      detected.forEach((className) => {
        context.report({
          node,
          messageId: 'negativeArbitraryValue',
          data: {
            classname: className,
          },
        });
      });
    };

    //----------------------------------------------------------------------
    // Public
    //----------------------------------------------------------------------

    const attributeVisitor = function (node) {
      if (!astUtil.isValidJSXAttribute(node)) {
        return;
      }
      parseForNegativeArbitraryClassNames(node);
    };

    const scriptVisitor = {
      JSXAttribute: attributeVisitor,
      TextAttribute: attributeVisitor,
      CallExpression: function (node) {
        if (callees.findIndex((name) => node.callee.name === name) === -1) {
          return;
        }
        node.arguments.forEach((arg) => {
          parseForNegativeArbitraryClassNames(node, arg);
        });
      },
      TaggedTemplateExpression: function (node) {
        if (!tags.includes(node.tag.name)) {
          return;
        }
        parseForNegativeArbitraryClassNames(node, node.quasi);
      },
    };

    const templateVisitor = {
      VAttribute: function (node) {
        if (!astUtil.isValidVueAttribute(node)) {
          return;
        }
        parseForNegativeArbitraryClassNames(node);
      },
    };

    return parserUtil.defineTemplateBodyVisitor(context, templateVisitor, scriptVisitor);
  },
};