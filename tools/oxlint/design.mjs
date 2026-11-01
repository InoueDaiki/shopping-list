// デザインシステムを守るための、oxlint の JS プラグイン(ESLint と同じ形)。
// 色はトークン(packages/design-tokens)の名前で、Tailwind のクラスとして書く。
// ここでは Tailwind のクラスの外で色を直に書いたものを見つける。

// #fff、#ffffff、#ffffff80 など
const HEX_COLOR = /(?:^|[\s:(,'"])#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})(?![0-9a-z_-])/i;
// rgb(…)、oklch(…)、color-mix(…) など
const COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/i;
// style で色を決めるプロパティ
const COLOR_PROPERTY = /color|background|border|outline|fill|stroke|shadow/i;

const RAW_COLOR_MESSAGE =
  "色を直に書かない。トークンの名前を Tailwind のクラスで使う(packages/design-tokens/generated/TOKENS.md)";

function checkText(context, node, text) {
  if (HEX_COLOR.test(text) || COLOR_FUNCTION.test(text)) {
    context.report({ node, message: RAW_COLOR_MESSAGE });
  }
}

const noRawColor = {
  meta: {
    type: "problem",
    docs: { description: "HEX や rgb() などの色を直に書かない" },
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value === "string") {
          checkText(context, node, node.value);
        }
      },
      TemplateElement(node) {
        checkText(context, node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};

const noStyleColor = {
  meta: {
    type: "problem",
    docs: { description: "style 属性で色・線・影を決めない" },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "style") {
          return;
        }
        const expression = node.value?.type === "JSXExpressionContainer" ? node.value.expression : undefined;
        if (expression?.type !== "ObjectExpression") {
          return;
        }
        for (const property of expression.properties) {
          if (property.type !== "Property") {
            continue;
          }
          const key =
            property.key.type === "Identifier"
              ? property.key.name
              : typeof property.key.value === "string"
                ? property.key.value
                : undefined;
          if (key && COLOR_PROPERTY.test(key)) {
            context.report({
              node: property,
              message: `style の ${key} で色や線を決めない。トークンの名前を Tailwind のクラスで使う(packages/design-tokens/generated/TOKENS.md)`,
            });
          }
        }
      },
    };
  },
};

export default {
  meta: { name: "design" },
  rules: {
    "no-raw-color": noRawColor,
    "no-style-color": noStyleColor,
  },
};
