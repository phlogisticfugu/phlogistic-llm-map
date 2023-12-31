import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
const container = d3.select("#container");

// Declare the chart dimensions and margins.
const width = window.innerWidth - 40;
const height = window.innerHeight - 40;
const marginTop = 20;
const marginRight = 80;
const marginBottom = 20;
const marginLeft = 40;
const textLabelOffset = 10;

const models = await d3.csv("models.csv");
const prepped_models = models
    .map(d => {
        d.publish_date_obj = new Date(d.publish_date);
        if (d.num_citations > 0) {
            d.radius = Math.max(4, Math.sqrt(5 * Math.log(d.num_citations)))
        } else {
            d.radius = 3
        }
        return d
    });

const stratify = d3.stratify()
    .id((d) => d.name)
    .parentId((d) => d.predecessor_name);
const root = stratify(prepped_models);

const nodes = root.descendants();
const links = root.links();
const max_depth = d3.max(nodes, d => d.depth);

// fix positions to spread out the tree branches
const root_y = (height / 2) + 120;
root.fy = root_y;
const first_children_trees = root.children
    .filter(d => ["BERT", "GPT"].includes(d.data.name))
first_children_trees.forEach((tree, i) => {
    const height_increment = height / (first_children_trees.length + 1);
    const target_y = 45 + (i + 1) * height_increment;
    tree.fy = target_y;
    tree.descendants().forEach(d => {
        if (d.data.name.toLowerCase().startsWith("bloom")) {
            // positioning hack
            d.target_y = target_y + 170
        } else {
            d.target_y = target_y
        }
    });
})
const middle_children_trees = root.children
    .filter(d => !["BERT", "GPT", "PaLM"].includes(d.data.name))
middle_children_trees.forEach((tree, i) => {
    const height_increment = 200 / (middle_children_trees.length + 1);
    const target_y = root_y + (i + 1) * height_increment;
    tree.fy = target_y;
    tree.descendants().forEach(d => {
        d.target_y = target_y
    });
})

// Declare the x (horizontal position) scale.
const scale_x = d3.scaleUtc()
    .domain(d3.extent(prepped_models, d => d.publish_date_obj))
    .range([marginLeft, width - marginRight]);

const _publishers = Array.from(new Set(prepped_models.map(d => d.publisher)));
const publishers_with_num_models = _publishers
    .map(publisher => {
        const num_models = prepped_models.filter(d => d.publisher === publisher).length;
        return {
            publisher,
            num_models
        }
    })
    .sort((a, b) => b.num_models - a.num_models);
const publishers = publishers_with_num_models.map(d => d.publisher);
const color_scale = d3.scaleOrdinal(d3.schemeTableau10).domain(publishers); 
const publisher_css_class_map = {};
publishers.forEach((publisher) => {
    publisher_css_class_map[publisher] = publisher.replace(/\W+/g, "-").toLowerCase()
});

const years = d3.range(
    d3.min(prepped_models, d => d.publish_date_obj).getFullYear(),
    d3.max(prepped_models, d => d.publish_date_obj).getFullYear() + 1
)
.filter(y => y > 2018);

const simulation = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id((d) => d.name).distance(30).strength(0.3))
    .force("charge", d3.forceManyBody().strength(-300))
    .force("collide", d3.forceCollide().radius(32).strength(3))
    .force("x", d3.forceX(d => scale_x(d.data.publish_date_obj)).strength(10))
    .force("y", d3.forceY(d => !!d.target_y ? d.target_y : height / 2).strength(d => 0.05 * (max_depth + 1 - d.depth)));

// Create the SVG container.
const svg = d3.create("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", [10, 10, width, height])
    .attr("style", "max-width: 100%; height: auto;");

// Append links.
const link = svg.append("g")
    .attr("stroke", "#aaaaaa")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("stroke-width", d => {
        const num_descendents = d.target.descendants().length;
        return Math.max(Math.log(num_descendents), 1);
    });

 // Append nodes.
 const node = svg.append("g")
    .attr("class", "node")
    .selectAll("g")
    .data(nodes)
    .enter()
    .append("g")
    .call(dragHandler(simulation));

node.append("circle")
    .attr("fill", d => color_scale(d.data.publisher))
    .attr("r", d => d.data.radius)
    .attr("stroke", d => d.data.is_free_commercial_use === "Y" ? "#444444" : "none")
    .attr("stroke-width", "3")
    .on("mouseover", handleMouseOver)
    .on("mouseout", handleMouseOut);

node.append("a")
    .attr("xlink:href", d => d.data.publish_url)
    .attr("target", "_blank")
    .append("text")
    .attr("class", d => `node-text ${publisher_css_class_map[d.data.publisher]}`)
    .attr("dy", -textLabelOffset)
    .attr("text-anchor", "middle")
    .attr("text-decoration", d => !!d.data.publish_url ? "underline" : "none")
    .text(d => d.data.name)
    .on("mouseover", handleMouseOver)
    .on("mouseout", handleMouseOut);

// Add the x-axis.
svg.append("g")
    .attr("transform", `translate(0,${height - marginBottom})`)
    .call(d3.axisBottom(scale_x))
    .selectAll("text")
    .style("font-size", "22px");

// Add a legend
const legend = svg.append("g")
    .attr("class", "legend")
    .attr("transform", `translate(${marginLeft}, ${marginTop})`)  // Moved to upper left
    .selectAll("g")
    .data(publishers_with_num_models)
    .enter().append("g")
    .attr("transform", (d, i) => `translate(0, ${i * 20})`);

// legend color blocks
legend.append("rect")
    .attr("width", 18)
    .attr("height", 18)
    .attr("fill", d => color_scale(d.publisher));

// legend text
legend.append("text")
    .attr("x", 24)
    .attr("y", 9)
    .attr("class", "legend-text")
    .attr("dy", "0.35em")
    .text(d => {
        const publisher = d.publisher;
        const num_models = d.num_models;
        if (num_models > 1) {
            return `${publisher} (${num_models})`
        } else {
            return publisher
        }
    })
    .on("mouseover", function(_, d) {
        svg.selectAll(`.node-text.${publisher_css_class_map[d.publisher]}`)
            .style("font-weight", "bold");
    })
    .on("mouseout", function(_, d) {
        svg.selectAll(`.node-text.${publisher_css_class_map[d.publisher]}`)
            .style("font-weight", "normal");
    });

const verticalLines = svg.append("g")
    .attr("class", "vertical-lines");
years.forEach(year => {
    verticalLines.append("line")
        .attr("x1", scale_x(new Date(year, 0, 1)))
        .attr("y1", marginTop)
        .attr("x2", scale_x(new Date(year, 0, 1)))
        .attr("y2", height - marginBottom)
        .attr("stroke", "#c9c9c9")
        .attr("stroke-dasharray", "2,2");
});

const descriptionBoxWidth = 420;
const descriptionBoxHeight = 50;

const descriptionBox = svg.append("g")
    .attr("transform", `translate(${marginLeft}, ${height - marginBottom - descriptionBoxHeight})`);

descriptionBox.append("rect")
    .attr("width", descriptionBoxWidth)
    .attr("height", descriptionBoxHeight)
    .attr("fill", "#fff");

descriptionBox.append("text")
    .attr("x", 15)
    .attr("y", 20)
    .attr("class", "text-box")
    .attr("dy", "0.35em")
    .style("font-size", "18px") // Set the font size of the text
    .text("https://github.com/phlogisticfugu/phlogistic-llm-map");

simulation.on("tick", () => {
    link
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);

    node
        .each(d => { // Add this block to constrain the nodes
            d.x = Math.max(marginLeft + d.data.radius, Math.min(width - marginRight - d.data.radius, d.x));
            d.y = Math.max(marginTop + textLabelOffset + d.data.radius, Math.min(height - marginBottom - d.data.radius, d.y));
        })
        .attr("transform", d => `translate(${d.x},${d.y})`); // Move the entire g element to new x,y position
});

function dragHandler(simulation) {
    function dragstarted(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }

    function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }

    function dragended(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
    }

    return d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended);
}

// Function to handle mouseover event
function handleMouseOver(event, d) {
  // Append a custom tooltip with rich content
  const tooltip = d3.select("body")
    .append("div")
    .attr("class", "tooltip")
    .style("position", "absolute")
    .style("pointer-events", "none")
    .style("left", event.pageX + 10 + "px") // Position the tooltip relative to the mouse
    .style("top", event.pageY + 10 + "px");

  // Add rich content to the tooltip
  let content_html = `
    <h3>${d.data.name}</h3>
    <p>${d.data.publish_date} - ${d.data.publisher}</p>
  `
  if (d.data.num_citations > 0) {
    content_html += `<p>Google Scholar Citations: ${d.data.num_citations}</p>`
  } else {
    content_html += "<p>No Preprint Paper</p>"
  }
  if (d.data.is_free_commercial_use === "Y") {
    content_html += "<p>Free for commercial use</p>"
  }
  tooltip.html(content_html);
}

// Function to handle mouseout event
function handleMouseOut() {
  // Remove the custom tooltip when the mouse moves out of the node
  d3.select(".tooltip").remove();
}

container
    .append(() => svg.node());

container
    .selectAll(".img-fallback").style("display", "none");
